/* use this to build bundle_collab.js: browserify build.js --outfile collab_bundle.js */

const {exampleSetup, buildMenuItems} = require("prosemirror-example-setup")
const {Step} = require("prosemirror-transform")
const {MenuBarEditorView} = require("prosemirror-menu")
const {EditorState} = require("prosemirror-state")
const {history} = require("prosemirror-history")
const {collab, receiveTransaction, sendableSteps, getVersion} = require("prosemirror-collab")
const {DOMParser, Schema} = require("prosemirror-model")
const {schema: baseSchema} = require("prosemirror-schema-basic")
const {addListNodes} = require("prosemirror-schema-list")

window.pmCollabReqs={};
pmCollabReqs.exampleSetup=exampleSetup;
pmCollabReqs.buildMenuItems=buildMenuItems;
pmCollabReqs.Step=Step; 
pmCollabReqs.MenuBarEditorView=MenuBarEditorView; 
pmCollabReqs.EditorState=EditorState; 
pmCollabReqs.history=history; 
pmCollabReqs.collab=collab;
pmCollabReqs.receiveTransaction=receiveTransaction;
pmCollabReqs.sendableSteps=sendableSteps;
pmCollabReqs.DOMParser=DOMParser;
pmCollabReqs.Schema=Schema;
pmCollabReqs.baseSchema=baseSchema;
pmCollabReqs.addListNodes=addListNodes;


