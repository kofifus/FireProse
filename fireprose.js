"use strict";

// the FireProse 'class' using https://github.com/kofifus/New
function FireProse() {
  const Step = window.pmCollabReqs.Step;
  const sendableSteps = window.pmCollabReqs.sendableSteps;

  let baseref, view, getState, editState;

  let lastSendTime;
  let listeningVer, sendingVer;

  const sendThrottleMs = 1000;
  const trace = true;

  // helpers

  function logVersion(version, versionNum) {
    if (!version) return (versionNum ? 'v' + versionNum + ' ' : '') + 'empty';
    let res = 'v' + (versionNum ? versionNum : version.versionNum) + ' ';
    if (!version.steps) res += 'null';
    else res += version.steps.length.toString() + ' steps';
    if (res.hasOwnProperty('committed')) res += ' ' + (res.committed ? 'committed' : 'uncommitted');
    return res;
  }

  // recieves array of { versionNum, steps, clientID} }, updates the view state and optionally the view
  function receive(versions, updateView) {
    if (versions.length === 0) return;

    let steps = [],
      clientIDs = [],
      log = '';

    for (let i = 0; i < versions.length; i++) {
      steps = steps.concat(versions[i].steps);
      for (let s = 0; s < versions[i].steps.length; s++) clientIDs.push(versions[i].clientID);
      log += (log ? ' , ' : '') + logVersion(versions[i]);
    }

    let tr = window.pmCollabReqs.receiveTransaction(editState, steps, clientIDs);
    editState = editState.apply(tr);
    if (updateView) view.updateState(getState().apply(tr));
    console.log((updateView ? 'received ' : 'sent ') + log);
  }

  function stepsToJSON(steps) {
    return steps.map(s => s.toJSON());
  }

  function stepsFromJSON(json) {
    return json.map(j => Step.fromJSON(getState().schema, j));
  }

  // turn revision to a lexigaraphically ordered ID (string)
  function revisionToId(revision) {
    const characters = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    if (revision === 0) return 'A0';
    let str = '';
    while (revision > 0) {
      let digit = (revision % characters.length);
      str = characters[digit] + str;
      revision -= digit;
      revision /= characters.length;
    }
    let prefix = characters[str.length + 9]; // Prefix with length (starting at 'A' for length 1) to ensure the id's sort lexicographically.
    return prefix + str;
  }

  // and reverse
  function revisionFromId(revisionId) {
    const characters = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    // assert(revisionId.length > 0 && revisionId[0] === characters[revisionId.length + 8]);
    let revision = 0;
    for (let i = 1; i < revisionId.length; i++) {
      revision *= characters.length;
      revision += characters.indexOf(revisionId[i]);
    }
    return revision;
  }

  // get all versions from 0, returns [{versionNum, steps, ..}]
  // steps are converted from json
  function versionGetAll() {
    return baseref.orderByKey().once('value').then(snapshot => {
      if (snapshot.val() === null) return null;
      let res = [];
      snapshot.forEach(childSnapshot => {
        let version = childSnapshot.val();
        version.versionNum = revisionFromId(childSnapshot.key);
        if (version.steps) version.steps = stepsFromJSON(version.steps);
        res.push(version);
      });
      return res;
    });
  }

  // on('value') starting at fromVersion, returns {versionNum, steps, ..}
  // steps are converted from json
  // listening stops after receiving a version, pass -1 to stop listening
  function versionListen(versionNum, callback) {
    const currVersionNum = (versionListen.currRef ? revisionFromId(versionListen.currRef.key) : -1);
    if (versionNum === currVersionNum) return; // nothing to do
    if (trace) console.log('listen ' + (versionNum === -1 ? 'v' + currVersionNum + ' off' : 'at v' + listeningVer));

    if (versionListen.currRef) {
      versionListen.currRef.off();
      versionListen.currRef = null;
    }
    if (versionNum === -1) return;

    let versionID = revisionToId(versionNum);
    versionListen.currRef = baseref.child(versionID);
    versionListen.currRef.on('value', childSnapshot => {
      const version = childSnapshot.val();
      if (version === null) return;
      version.versionNum = revisionFromId(childSnapshot.key);
      if (version.steps) version.steps = stepsFromJSON(version.steps);
      //if (trace) console.log('onChildChanged v' + childSnapshot.key + ' ' + (val === null ? 'null' : 'obj'));
      callback(version);
    });
  }

  // transaction at versionNum, resolves with { versionNum, committed, steps? }
  // steps are converted to/from json
  function versionTransaction(versionNum, transactionUpdate) {
    return baseref.child(revisionToId(versionNum)).transaction(version => {
      if (version && version.steps) version.steps = stepsFromJSON(version.steps);
      let updated = transactionUpdate(version);
      if (updated) {
        if (updated.steps) updated.steps = stepsToJSON(updated.steps);
        delete updated.versionNum;
        delete updated.comitted;
      }
      return updated;
    }, undefined, false).then(res => {
      //if (trace) console.log('fbVersionTransaction v'+versionNum+' then ' + res.committed + ' ' + (res.value === null ? 'null' : 'obj'));
      let resVersion = res.snapshot.val() || {};
      resVersion.versionNum = versionNum;
      if (resVersion.steps) resVersion.steps = stepsFromJSON(resVersion.steps);
      resVersion.committed = res.committed;
      return resVersion;
    });
  }

  // get a steps array and returns it with as much merging as possible
  function mergeStepsArray(steps) {
    let res = [],
      current = steps[0];
    for (let i = 1; i < steps.length; i++) {
      let newStep = current.merge(steps[i]);
      if (newStep) {
        current = newStep;
      } else {
        res.push(current);
        current = steps[i];
      }
    }
    res.push(current)
    return res;
  }

  // main

  function listen() {
    versionListen(-1);
    versionListen(listeningVer, version => {
      let getVersionNum = listeningVer;
      versionListen(-1);
      listeningVer = -1;
      getVersion(getVersionNum);
    });
  }

  function dispatchTransaction(tr) {
    editState = editState.apply(tr);

    // throttle sends
    if (new Date().getTime() - lastSendTime > sendThrottleMs) {
      send();
    } else {
      clearTimeout(dispatchTransaction.timeout)
      dispatchTransaction.timeout = setTimeout(send, sendThrottleMs);
    }
  }

  function send() {
    let sendable = sendableSteps(editState);
    if (!sendable) return;

    if (listeningVer === -1) {
      setTimeout(send, sendThrottleMs); // busy, try again
      return;
    }

    versionListen(-1);
    listeningVer = -1;

    let version = {
      versionNum: sendingVer,
      steps: sendable.steps,
      clientID: sendable.clientID
    }

    //if (trace) console.log('sending to version ' + sendingVer);
    let used, taken;
    versionTransaction(sendingVer, remoteVersion => {
      used = (remoteVersion !== null && remoteVersion.clientID == version.clientID && remoteVersion.unused !== true);
      taken = (remoteVersion !== null && remoteVersion.clientID !== version.clientID);
      if (used || taken) return undefined; // cancel transaction

      return {
        versionNum: version.versionNum,
        steps: mergeStepsArray((remoteVersion ? remoteVersion.steps : []).concat(version.steps)),
        clientID: version.clientID,
        unused: true
      }

    }).then(remoteVersion => {
      if (remoteVersion.committed) {
        //if (trace) console.log('sent ' + logVersion(remoteVersion));
        receive([version]);
        listeningVer = sendingVer + 1;
        lastSendTime = new Date().getTime();
      } else if (used) {
        if (trace) console.log('send cancelled, starting new version');
        listeningVer = ++sendingVer;
      } else if (taken) {
        if (trace) console.log('send cancelled, needs rebasing');
      }
      listen();
    }, () => {
      return;
    }).then(() => {
      setTimeout(send, sendThrottleMs);
    });
  }

  function getVersion(getVersionNum) {
    return versionTransaction(getVersionNum, version => {
      //if (trace) console.log('getVersion updateFunc '+logVersion(version));
      if (version) delete version.unused; // mark version as used
      return version;
    }).then(version => {
      if (trace) console.log('getVersion got ' + logVersion(version));
      receive([version], true);
      sendingVer = listeningVer = getVersionNum + 1;
      listen();
    }, () => {
      setTimeout(() => getVersion(getVersionNum), 100);
    });
  }

  function ctor(view_, getState_, baseref_, loaded) {
    view = view_;
    getState = getState_;
    baseref = baseref_;
    editState = getState();

    lastSendTime = new Date().getTime(),
    listeningVer = sendingVer = 0;
  
    versionGetAll().then(versions => {
      if (versions.length === 0) {
        console.log('getAll() no versions');
        loaded();
        listen();
      } else {
        // we get the last version with getVersion so as to mark it as used
        versions.pop();
        receive(versions, true);
        getVersion(versions.length).then(() => loaded());
      }
    }, err => {
      console.log('getAll error ' + err);
    })
  }

  return {
    ctor,
    dispatchTransaction
  }
}
