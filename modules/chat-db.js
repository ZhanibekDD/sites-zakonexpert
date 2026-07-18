'use strict';
const Datastore = require('nedb-promises');
const path = require('path');
const { enableAutocompaction } = require('./db-maintenance');

const db = Datastore.create({
  filename: path.join(__dirname, '..', 'data', 'chat.db'),
  autoload: true,
});
enableAutocompaction(db);
db.ensureIndex({ fieldName: 'sessionId', unique: true }).catch(() => {});
db.ensureIndex({ fieldName: 'botMsgIds' }).catch(() => {});

async function getOrCreate(sessionId, page) {
  let session = await db.findOne({ sessionId });
  if (!session) {
    const chatNumber = (await db.count({})) + 1;
    session = await db.insert({
      sessionId, page, chatNumber, createdAt: Date.now(), messages: [], botMsgIds: [],
    });
  }
  return session;
}

async function addClientMessage(sessionId, text, page) {
  const session = await getOrCreate(sessionId, page);
  await db.update({ sessionId }, { $push: { messages: { from: 'client', text, ts: Date.now() } } });
  return session.chatNumber;
}

async function pushBotMsgId(sessionId, msgId) {
  await db.update({ sessionId }, { $push: { botMsgIds: msgId } });
}

// Called when the site owner replies (in Telegram) to a message that was
// forwarded for some chat session — routes the reply back to that session.
async function addAdminMessageByBotMsgId(botMsgId, text) {
  const session = await db.findOne({ botMsgIds: botMsgId });
  if (!session) return null;
  await db.update({ sessionId: session.sessionId }, { $push: { messages: { from: 'admin', text, ts: Date.now() } } });
  return { sessionId: session.sessionId, chatNumber: session.chatNumber };
}

async function getMessagesSince(sessionId, sinceTs) {
  const session = await db.findOne({ sessionId });
  if (!session) return [];
  return session.messages.filter(m => m.ts > (sinceTs || 0));
}

module.exports = { getOrCreate, addClientMessage, pushBotMsgId, addAdminMessageByBotMsgId, getMessagesSince };
