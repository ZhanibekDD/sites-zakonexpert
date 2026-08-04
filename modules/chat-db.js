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
      sessionId, page, chatNumber, createdAt: Date.now(), updatedAt: Date.now(), messages: [], botMsgIds: [],
    });
  }
  return session;
}

async function addClientMessage(sessionId, text, page) {
  const session = await getOrCreate(sessionId, page);
  const now = Date.now();
  await db.update({ sessionId }, { $push: { messages: { from: 'client', text, ts: now } }, $set: { updatedAt: now } });
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
  const now = Date.now();
  await db.update({ sessionId: session.sessionId }, { $push: { messages: { from: 'admin', text, ts: now } }, $set: { updatedAt: now } });
  return { sessionId: session.sessionId, chatNumber: session.chatNumber };
}

async function getMessagesSince(sessionId, sinceTs) {
  const session = await db.findOne({ sessionId });
  if (!session) return [];
  return session.messages.filter(m => m.ts > (sinceTs || 0));
}

async function purgeOlderThan(cutoff) {
  const sessions = await db.find({});
  const expired = sessions.filter(session => {
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const lastMessageAt = messages.reduce((latest, message) => Math.max(latest, Number(message.ts) || 0), 0);
    return Math.max(Number(session.updatedAt) || 0, lastMessageAt, Number(session.createdAt) || 0) < cutoff;
  });
  await Promise.all(expired.map(session => db.remove({ _id: session._id })));
  return expired.length;
}

module.exports = { getOrCreate, addClientMessage, pushBotMsgId, addAdminMessageByBotMsgId, getMessagesSince, purgeOlderThan };
