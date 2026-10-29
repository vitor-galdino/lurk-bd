/**
 * @name Lurk
 * @author Vitor
 * @authorLink https://github.com/vitor-galdino
 * @version 2.3.0
 * @description See who typed to you and gave up, catch ghost pings and deleted messages, and keep an eye on your VIPs.
 * @website https://github.com/vitor-galdino/lurk-bd
 * @source https://github.com/vitor-galdino/lurk-bd/blob/main/Lurk.plugin.js
 * @updateUrl https://raw.githubusercontent.com/vitor-galdino/lurk-bd/main/Lurk.plugin.js
 */
"use strict";

const PLUGIN = "Lurk";
const LEGACY = "DMTypingTracker"; // nome antigo, só para migrar os dados
const VERSION = "2.3.0";
const REPO = "vitor-galdino/lurk-bd";
const UPDATE_URL = `https://raw.githubusercontent.com/${REPO}/main/Lurk.plugin.js`;
// Novidades de cada versão (aparecem depois que o Lurk se atualiza)
const CHANGELOG = [
  { version: "2.3.0", items: [
    ["new", "O Lurk agora se atualiza sozinho.", "Lurk now updates itself."],
    ["new", "Depois de cada atualização você escolhe se quer ver as novidades. Ajuste em Ajustes › Atualizações.", "After each update you choose whether to see what's new. Change it in Settings › Updates."],
  ] },
];
const { Webpack, Patcher, React, Components, Data, UI, DOM, ContextMenu, Logger } = new BdApi(PLUGIN);
const RawData = BdApi.Data; // arquivos separados (VIP, menções, calls, som, backup)
const h = React.createElement;

/* ================================================================== */
/* Stores / módulos do Discord (tudo com fallback)                     */
/* ================================================================== */
const safe = (fn) => { try { return fn() ?? null; } catch { return null; } };
const store = (name) => safe(() => Webpack.getStore(name));
const UserStore = store("UserStore");
const ChannelStore = store("ChannelStore");
const GuildStore = store("GuildStore");
const RelationshipStore = store("RelationshipStore");
const SelectedChannelStore = store("SelectedChannelStore");
const MessageRequestStore = store("MessageRequestStore");
const PresenceStore = store("PresenceStore");
const MessageStore = store("MessageStore");
const VoiceStateStore = store("VoiceStateStore");
const UserGuildSettingsStore = store("UserGuildSettingsStore");
const RunningGameStore = store("RunningGameStore");
const SelfPresenceStore = store("SelfPresenceStore");
const UserProfileStore = store("UserProfileStore");
const GuildMemberStore = store("GuildMemberStore");
const PrivateChannelSortStore = store("PrivateChannelSortStore");
const Dispatcher = UserStore?._dispatcher;

const Spinner = Components.Spinner;
const SPINNER_TYPES = Object.keys(Spinner?.Type || {});

const upperContainerModule = safe(() => Webpack.getModule((m) => m?.upperContainer && m?.iconWrapper));
const transitionTo = safe(() =>
  Webpack.getByStrings("transitionTo - Transitioning to", { searchExports: true })
  || Webpack.getModule((m) => typeof m?.transitionTo === "function")?.transitionTo);
const PrivateChannelActions = safe(() => Webpack.getModule((m) => typeof m?.openPrivateChannel === "function"));
const RelationshipActions = safe(() => Webpack.getModule((m) => typeof m?.removeRelationship === "function" && typeof m?.addRelationship === "function"));
const ProfileActions = safe(() => Webpack.getModule((m) => typeof m?.fetchProfile === "function"));
const UserFetcher = safe(() => Webpack.getModule((m) => typeof m?.getUser === "function" && typeof m?.fetchCurrentUser === "function"));
const GatewayModule = safe(() => Webpack.getByKeys("getSocket"));
// Sons do Discord: o módulo tem nomes de funções minificados, então é achado pelo código
// (mesma assinatura que o BDFDB usa) e as funções pelo que fazem.
const SoundUtils = (() => {
  const raw = safe(() => Webpack.getModule((m) => typeof m?.playSound === "function"))
    || safe(() => Webpack.getModule(Webpack.Filters.bySource(".disableSounds)", ".getSoundpack()", "Unable to find sound for pack name")));
  if (!raw) return null;
  if (typeof raw.playSound === "function") return { play: raw.playSound, create: raw.createSound, via: "props" };
  const fns = Object.values(raw).filter((v) => typeof v === "function");
  const play = fns.find((f) => String(f).includes("playWithListener"));
  const create = fns.find((f) => String(f).includes(";return new "));
  return play || create ? { play, create, via: "source" } : null;
})();
const ReactDOMClient = safe(() => (BdApi.ReactDOM?.createRoot ? BdApi.ReactDOM : Webpack.getByKeys("createRoot", "hydrateRoot")));

/* ================================================================== */
/* Configurações                                                        */
/* ================================================================== */
const TYPING_TIMEOUT = 12000; // o Discord reenvia o sinal a cada ~10s; sem sinal novo em 12s = parou
const DISCORD_SOUNDS = ["message1", "message2", "message3", "mention1", "mention2", "mention3", "ddm", "user_join", "user_leave", "ptt_start", "ptt_stop", "stream_started", "activity_launch", "reconnect", "mute", "unmute"];
const DEFAULTS = {
  // monitoramento
  trackGroupDMs: true,
  trackUnknownChannels: true,
  recordPresence: true,
  mergeWindow: 60,
  minDuration: 0,
  sentLaterWindow: 10,
  maxEntries: 2000,
  // barra de servidores
  showGuildBarAvatar: true,
  hideWhenChannelOpen: true,
  spinnerType: SPINNER_TYPES.includes("PULSING_ELLIPSIS") ? "PULSING_ELLIPSIS" : (SPINNER_TYPES[0] || ""),
  // avisos: começou a digitar
  startToast: false,
  startDesktop: false,
  startSound: false,
  // avisos: desistiu
  notifyToast: false,
  notifyDesktop: false,
  notifySound: false,
  notifyEachAttempt: false,
  // som
  soundSource: "beep",
  discordSound: "message1",
  soundVolume: 40,
  // VIP
  vipTrackServers: true,
  vipRecordMessages: true,
  vipToast: true,
  vipDesktop: true,
  vipSound: false,
  vipMaxMessages: 5000,
  vipRecordDMs: true,
  vipTrackVoice: true,
  vipSubscribeTyping: true,
  // calls e histórico de apagadas/editadas (VIP)
  trackMyCalls: true,
  showSnipeButton: true,
  lurkIcon: "ghost", // ghost | ninja | eye
  // primeiro contato
  firstContactTrack: true,
  firstToast: false,
  firstDesktop: false,
  firstSound: false,
  // menções
  mentionGhost: true,
  mentionReply: true,
  mentionReaction: true,
  mentionToast: false,
  mentionDesktop: false,
  mentionSound: false,
  keywords: "",
  keywordIgnoreMuted: true,
  keywordToast: false,
  keywordDesktop: false,
  keywordSound: false,
  // modo foco (opcional)
  focusMode: false,
  focusOnDnd: true,
  focusWhilePlaying: true,
  // backup
  backupEnabled: true,
  backupDays: 7,
  backupKeep: 3,
  // pedidos de amizade
  friendReqTrack: true,
  friendReqToast: false,
  friendReqDesktop: false,
  friendReqSound: false,
  // interruptor geral: desligado = o Lurk não mostra nenhum toast (só erros)
  toastsEnabled: true,
  // idioma: auto = segue o Discord (pt-BR → português, qualquer outro → inglês)
  language: "auto",
  // atualizações
  changelogMode: "ask", // ask | always | never
  // botão
  showToolbarButton: true,
  showBadge: true,
};
let settingsCache = null;
const getSettings = () => (settingsCache ??= { ...DEFAULTS, ...(Data.load("settings") || {}) });
const setSetting = (id, value) => {
  settingsCache = { ...getSettings(), [id]: value };
  Data.save("settings", settingsCache);
  settingsBus.emit();
};

/* ================================================================== */
/* Idioma                                                               */
/* ================================================================== */
const LocaleStore = store("LocaleStore");
function lang() {
  const pref = getSettings().language;
  if (pref === "pt" || pref === "en") return pref;
  const loc = safe(() => LocaleStore?.locale) || safe(() => document.documentElement.lang) || "en";
  return /^pt/i.test(loc) ? "pt" : "en";
}
// L("texto em português", "text in English")
const L = (pt, en) => (lang() === "pt" ? pt : en);
const plural = (n, one, many) => (n === 1 ? one : many);
const dateLocale = () => L("pt-BR", "en-US");

// Todo toast do Lurk passa por aqui; respeita o interruptor geral (erros sempre aparecem)
function toast(text, opts = {}) {
  if (opts.type !== "error" && !getSettings().toastsEnabled) return;
  try { UI.showToast(text, opts); } catch {}
}

/* ================================================================== */
/* Atualização automática                                               */
/* ================================================================== */
const cmpVer = (a, b) => {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
};
const updater = { checking: false, lastCheck: 0, latest: null, error: null, notice: null };
const updateBus = { subs: new Set(), emit() { this.subs.forEach((f) => { try { f(); } catch {} }); }, sub(f) { this.subs.add(f); return () => this.subs.delete(f); } };
async function fetchText(url) {
  const net = safe(() => BdApi.Net?.fetch);
  const res = net ? await BdApi.Net.fetch(url) : await fetch(url, { cache: "no-store" });
  if (!res.ok && res.status) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}
function pluginFilePath() {
  const path = require("path");
  const file = safe(() => BdApi.Plugins.get(PLUGIN)?.filename) || "Lurk.plugin.js";
  return path.join(BdApi.Plugins.folder, file);
}
function installUpdate(code) {
  return new Promise((resolve, reject) => {
    try { require("fs").writeFile(pluginFilePath(), code, (err) => (err ? reject(err) : resolve())); } catch (e) { reject(e); }
  });
}
// manual = clicou em "Procurar atualização"
async function checkForUpdate(manual = false) {
  if (updater.checking) return;
  updater.checking = true; updater.error = null; updateBus.emit();
  try {
    const code = await fetchText(`${UPDATE_URL}?t=${Date.now()}`);
    const remote = code.match(/@version\s+([\d.]+)/)?.[1];
    // só aceita um arquivo que seja mesmo o Lurk
    if (!remote || !/@name\s+Lurk\b/.test(code) || !code.includes("module.exports") || code.length < 20000) throw new Error(L("arquivo inválido no GitHub", "invalid file on GitHub"));
    updater.latest = remote;
    updater.lastCheck = Date.now();
    if (cmpVer(remote, VERSION) <= 0) { if (manual) toast(L(`O Lurk ${VERSION} é a versão mais recente.`, `Lurk ${VERSION} is up to date.`), { type: "success" }); return; }
    // sempre instala: correções de segurança precisam chegar a todo mundo
    await installUpdate(code); // o BetterDiscord recarrega o plugin sozinho
    if (manual) toast(L(`Atualizando para o Lurk ${remote}…`, `Updating to Lurk ${remote}…`), { type: "success" });
  } catch (e) {
    updater.error = String(e?.message || e);
    if (manual) toast(L(`Não consegui procurar atualização: ${updater.error}`, `Couldn't check for updates: ${updater.error}`), { type: "error" });
  } finally { updater.checking = false; updateBus.emit(); }
}
function changesSince(from) {
  return CHANGELOG.filter((c) => !from || cmpVer(c.version, from) > 0);
}
function showChangelog(from) {
  const list = changesSince(from);
  if (!list.length) return;
  const TITLES = { new: L("Novidades", "New"), improved: L("Melhorias", "Improved"), fixed: L("Correções", "Fixed") };
  const TYPES = { new: "added", improved: "improved", fixed: "fixed" };
  const groups = ["new", "improved", "fixed"].map((t) => ({ t, items: list.flatMap((c) => c.items.filter((i) => i[0] === t).map((i) => L(i[1], i[2]))) })).filter((g) => g.items.length);
  if (typeof UI.showChangelogModal === "function") {
    safe(() => UI.showChangelogModal({ title: "Lurk", subtitle: `${L("Versão", "Version")} ${VERSION}`, changes: groups.map((g) => ({ title: TITLES[g.t], type: TYPES[g.t], items: g.items })) }));
    return;
  }
  UI.showConfirmationModal(`Lurk ${VERSION}`, h("div", { className: "dmtt-changelog" }, groups.map((g) => h("div", { key: g.t },
    h("h3", null, TITLES[g.t]), h("ul", null, g.items.map((x, i) => h("li", { key: i }, x)))))), { confirmText: "OK", cancelText: null });
}
// roda no start: descobre se acabou de atualizar
function afterUpdateCheck() {
  const last = Data.load("lastVersion");
  Data.save("lastVersion", VERSION);
  if (!last || cmpVer(VERSION, last) <= 0 || !changesSince(last).length) return;
  const mode = getSettings().changelogMode;
  if (mode === "always") return setTimeout(() => showChangelog(last), 1500);
  if (mode === "never") return toast(L(`Lurk atualizado para ${VERSION}`, `Lurk updated to ${VERSION}`), { type: "success" });
  const close = safe(() => UI.showNotice(L(`O Lurk foi atualizado para ${VERSION}.`, `Lurk was updated to ${VERSION}.`), { type: "success", timeout: 0, buttons: [
    { label: L("Ver novidades", "See what's new"), onClick: () => { safe(() => close?.()); showChangelog(last); } },
  ] }));
  if (!close) toast(L(`Lurk atualizado para ${VERSION}`, `Lurk updated to ${VERSION}`), { type: "success" });
}

/* ================================================================== */
/* Eventos para o React                                                 */
/* ================================================================== */
function createBus() {
  const listeners = new Set();
  return {
    sub(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit() { listeners.forEach((fn) => { try { fn(); } catch (e) { Logger.error(e); } }); },
  };
}
const liveBus = createBus();
const historyBus = createBus();
const settingsBus = createBus();
const vipBus = createBus();
const reqBus = createBus();
const mentionBus = createBus();
const backupBus = createBus();
function useBus(...buses) {
  const [, force] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => { const offs = buses.map((b) => b.sub(force)); return () => offs.forEach((o) => o()); }, []);
}
function useTicker(ms) {
  const [, force] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => { const t = setInterval(force, ms); return () => clearInterval(t); }, []);
}

/* ================================================================== */
/* Dados persistidos (por conta do Discord)                             */
/* ================================================================== */
const myId = () => UserStore?.getCurrentUser?.()?.id || "unknown";
const k = (name) => `${name}_${myId()}`;

/* ---------- histórico de digitação ---------- */
const attemptOf = (r) => ({ startedAt: r.startedAt, lastTypingAt: r.lastTypingAt, signals: r.signals || 1, presence: r.presence || null, presenceEnd: null });

function migrate(list) {
  if (list.every((r) => r.v === 2)) return { list, changed: false };
  const win = (Number(getSettings().mergeWindow) || 0) * 1000;
  const asc = list
    .map((r) => (r.v === 2 ? { ...r, attempts: [...r.attempts] } : { ...r, v: 2, attempts: [attemptOf(r)] }))
    .sort((a, b) => a.startedAt - b.startedAt);
  const out = [];
  const lastByPair = new Map();
  for (const r of asc) {
    const pair = `${r.channelId}:${r.userId}`;
    const prev = lastByPair.get(pair);
    if (prev && prev.status === "not_sent" && win > 0 && r.startedAt - prev.lastTypingAt <= win) {
      prev.attempts.push(...r.attempts);
      prev.lastTypingAt = Math.max(prev.lastTypingAt, r.lastTypingAt);
      prev.signals = (prev.signals || 0) + (r.signals || 0);
      if (r.status === "sent_later") { prev.status = r.status; prev.sentLaterAt = r.sentLaterAt; }
    } else {
      out.push(r);
      lastByPair.set(pair, r);
    }
  }
  return { list: out.sort((a, b) => b.lastTypingAt - a.lastTypingAt), changed: true };
}

let historyCache = null;
let historyOwner = null;
function getHistory() {
  if (!historyCache || historyOwner !== myId()) {
    historyOwner = myId();
    const { list, changed } = migrate(Data.load(k("history")) || []);
    historyCache = list;
    if (changed) Data.save(k("history"), list);
  }
  return historyCache;
}
function saveHistory(list) {
  historyCache = list;
  Data.save(k("history"), list);
  historyBus.emit();
  updateBadge();
}
const trim = (list) => list.slice(0, Math.max(50, Number(getSettings().maxEntries) || DEFAULTS.maxEntries));
function updateRecord(id, patch) { saveHistory(getHistory().map((r) => (r.id === id ? { ...r, ...patch } : r))); }
function deleteRecords(predicate) { saveHistory(getHistory().filter((r) => !predicate(r))); }

/* ---------- ignorados ---------- */
const getIgnored = () => Data.load(k("ignored")) || { users: {}, channels: {} };
const isIgnoredUser = (id) => !!getIgnored().users[id];
const isIgnoredChannel = (id) => !!getIgnored().channels[id];
function toggleIgnore(type, id, label) {
  const ig = getIgnored();
  if (ig[type][id]) delete ig[type][id];
  else ig[type][id] = { label: label || id, at: Date.now() };
  Data.save(k("ignored"), ig);
  if (ig[type][id]) {
    for (const [key, s] of sessions) {
      if ((type === "users" && s.userId === id) || (type === "channels" && s.channelId === id)) endSession(key, false);
    }
  }
  historyBus.emit();
}

const getSeenAt = () => Data.load(k("seenAt")) || 0;
const markSeen = () => { Data.save(k("seenAt"), Date.now()); updateBadge(); };

/* ---------- lista VIP ---------- */
const VIP_DEFAULT = { notifyOnline: true, notifyTyping: true, notifyInvisible: true, notifyVoice: true };
const getVipList = () => Data.load(k("vip")) || {};
const isVip = (id) => !!getVipList()[id];
const vipFlag = (id, field) => { const e = getVipList()[id]; return !!e && (e[field] ?? VIP_DEFAULT[field]); };
function setVip(id, value) {
  const list = getVipList();
  if (value === null) delete list[id];
  else list[id] = { ...VIP_DEFAULT, ...(list[id] || {}), ...value };
  Data.save(k("vip"), list);
  if (value !== null) {
    if (!presenceCache.has(id)) presenceCache.set(id, rawPresence(id));
    if (!vipVoice.has(id)) safe(() => initVoiceFor(id));
    scheduleSubscribe();
  } else {
    presenceCache.delete(id);
    safe(() => closeVoice(id));
  }
  vipBus.emit();
}
function toggleVip(id, label) {
  if (isVip(id)) setVip(id, null);
  else {
    setVip(id, { addedAt: Date.now(), label: label || id });
    toast(L(`${label || "Pessoa"} adicionada à Lista VIP`, `${label || "User"} added to your VIP list`), { type: "success" });
  }
}

// Eventos e mensagens dos VIPs ficam num arquivo separado (DMTypingTrackerVIP.config.json),
// pra não reescrever o histórico inteiro a cada mensagem.
const VIP_FILE = "LurkVIP";
const vipData = { owner: null, events: [], messages: [], voice: [], timer: null, dirty: false };
function loadVip() {
  if (vipData.owner === myId()) return vipData;
  flushVip();
  vipData.owner = myId();
  vipData.events = safe(() => RawData.load(VIP_FILE, `events_${myId()}`)) || [];
  vipData.messages = safe(() => RawData.load(VIP_FILE, `messages_${myId()}`)) || [];
  vipData.voice = safe(() => RawData.load(VIP_FILE, `voice_${myId()}`)) || [];
  return vipData;
}
function flushVip() {
  if (!vipData.dirty || !vipData.owner) return;
  clearTimeout(vipData.timer);
  try {
    RawData.save(VIP_FILE, `events_${vipData.owner}`, vipData.events);
    RawData.save(VIP_FILE, `messages_${vipData.owner}`, vipData.messages);
    RawData.save(VIP_FILE, `voice_${vipData.owner}`, vipData.voice);
  } catch (e) { Logger.error("VIP save", e); }
  vipData.dirty = false;
}
function saveVipSoon() {
  vipData.dirty = true;
  clearTimeout(vipData.timer);
  vipData.timer = setTimeout(flushVip, 1500);
  vipBus.emit();
  safe(() => updateSnipeBadge());
}
function addVipEvent(ev) {
  const d = loadVip();
  d.events = [ev, ...d.events].slice(0, 5000);
  saveVipSoon();
}
function deleteVipData(userId) {
  const d = loadVip();
  d.events = d.events.filter((e) => e.userId !== userId);
  d.messages = d.messages.filter((m) => m.userId !== userId);
  d.voice = d.voice.filter((v) => v.userId !== userId);
  saveVipSoon();
}

/* ---------- pedidos de amizade ---------- */
const getPendingReqs = () => Data.load(k("reqPending")) || {};
const savePendingReqs = (o) => Data.save(k("reqPending"), o);
const getCanceledReqs = () => (Data.load(k("reqCanceled")) || []).filter((r) => r?.userId && r?.at);
function saveCanceledReqs(list) { Data.save(k("reqCanceled"), list.slice(0, 2000)); reqBus.emit(); updateBadge(); }

/* ---------- menções (arquivo separado) ---------- */
const MENTION_FILE = "LurkMentions";
const mentionData = { owner: null, events: [], timer: null, dirty: false };
function loadMentions() {
  if (mentionData.owner === myId()) return mentionData;
  flushMentions();
  mentionData.owner = myId();
  mentionData.events = safe(() => RawData.load(MENTION_FILE, `events_${myId()}`)) || [];
  return mentionData;
}
function flushMentions() {
  if (!mentionData.dirty || !mentionData.owner) return;
  clearTimeout(mentionData.timer);
  try { RawData.save(MENTION_FILE, `events_${mentionData.owner}`, mentionData.events); } catch (e) { Logger.error("mentions save", e); }
  mentionData.dirty = false;
}
function saveMentionsSoon() {
  mentionData.dirty = true;
  clearTimeout(mentionData.timer);
  mentionData.timer = setTimeout(flushMentions, 1500);
  mentionBus.emit();
  updateBadge();
}
function addMentionEvent(ev) {
  const d = loadMentions();
  d.events = [{ id: `${ev.type}-${ev.messageId || ""}-${Date.now()}`, at: Date.now(), ...ev }, ...d.events].slice(0, 3000);
  saveMentionsSoon();
}
function deleteMentionEvents(pred) {
  const d = loadMentions();
  d.events = d.events.filter((e) => !pred(e));
  saveMentionsSoon();
}

/* ---------- migração do nome antigo (DMTypingTracker → Lurk) ---------- */
function migrateLegacy() {
  const me = myId();
  if (me === "unknown" || Data.load(`migrated_${me}`)) return false;
  let moved = 0;
  const copy = (oldFile, oldKey, save) => { const v = safe(() => RawData.load(oldFile, oldKey)); if (v !== undefined && v !== null) { save(v); moved++; } };
  if (!Data.load("settings")) copy(LEGACY, "settings", (v) => Data.save("settings", v));
  for (const key of ["history", "ignored", "seenAt", "vip", "reqPending", "reqCanceled", "firstContacts", "knownContacts"]) {
    if (Data.load(k(key)) == null) copy(LEGACY, `${key}_${me}`, (v) => Data.save(k(key), key === "firstContacts" ? v.filter((e) => e.via !== "message") : v));
  }
  const files = [[`${LEGACY}VIP`, VIP_FILE, ["events", "messages", "voice"]], [`${LEGACY}Mentions`, MENTION_FILE, ["events"]], [`${LEGACY}Calls`, CALL_FILE, ["sessions"]], [`${LEGACY}Backup`, BACKUP_FILE, ["list"]]];
  for (const [oldFile, newFile, keys] of files) {
    for (const kk of keys) { const key = `${kk}_${me}`; if (safe(() => RawData.load(newFile, key)) == null) copy(oldFile, key, (v) => RawData.save(newFile, key, v)); }
  }
  if (safe(() => RawData.load(SOUND_FILE, "file")) == null) copy(`${LEGACY}Sound`, "file", (v) => RawData.save(SOUND_FILE, "file", v));
  Data.save(`migrated_${me}`, Date.now());
  return moved > 0;
}

/* ---------- adicionar VIP pelo ID ---------- */
async function addVipById(input) {
  const id = String(input || "").match(/\d{17,20}/)?.[0];
  if (!id) return { ok: false, msg: L("Isso não parece um ID do Discord (17 a 20 números).", "That doesn't look like a Discord ID (17–20 digits).") };
  if (id === myId()) return { ok: false, msg: L("Esse é o seu próprio ID.", "That's your own ID.") };
  if (isVip(id)) return { ok: false, msg: L("Essa pessoa já está na Lista VIP.", "Already on your VIP list.") };
  let u = UserStore?.getUser?.(id);
  if (!u) { try { await UserFetcher?.getUser?.(id); } catch {} u = UserStore?.getUser?.(id); }
  if (!u) { try { await ProfileActions?.fetchProfile?.(id, { withMutualGuilds: true }); } catch {} u = UserStore?.getUser?.(id); }
  if (!u) return { ok: false, msg: L("Não encontrei ninguém com esse ID.", "No user found with that ID.") };
  const name = u.globalName || u.username;
  toggleVip(id, name);
  return { ok: true, id, name };
}

/* ================================================================== */
/* Diagnóstico                                                          */
/* ================================================================== */
const diag = { version: VERSION, guildBar: null, toolbar: null, openDM: null, typingEvents: [] };
let diagTimer = null;
function saveDiag() {
  clearTimeout(diagTimer);
  diagTimer = setTimeout(() => { try { Data.save("diagnostico", { ...diag, at: new Date().toISOString() }); } catch {} }, 3000);
}
function outline(el, depth = 0) {
  if (!el) return null;
  const cls = typeof el.className === "string" ? el.className : el.className?.baseVal || "";
  const o = { tag: el.tagName, cls: cls.slice(0, 90), aria: el.getAttribute?.("aria-label") || undefined, li: el.getAttribute?.("data-list-item-id") || undefined };
  if (depth < 2) o.kids = [...el.children].slice(0, 12).map((c) => outline(c, depth + 1));
  else o.kids = el.children.length;
  return o;
}

/* ================================================================== */
/* Helpers                                                              */
/* ================================================================== */
function defaultAvatar(user, id) {
  let idx = 0;
  try {
    idx = user?.discriminator && user.discriminator !== "0" ? Number(user.discriminator) % 5 : Number((BigInt(id) >> 22n) % 6n);
  } catch {}
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}
function avatarOf(user, id) {
  try { const url = user?.getAvatarURL?.(null, 128, true); if (url) return url; } catch {}
  return defaultAvatar(user, id);
}
function nameOf(userId, fallback = {}) {
  const u = UserStore?.getUser?.(userId);
  return u?.globalName || fallback.globalName || fallback.name || u?.username || fallback.username || fallback.label || L("Usuário desconhecido", "Unknown user");
}
const displayName = (rec) => nameOf(rec.userId, rec);
const usernameOf = (userId, fallback = {}) => UserStore?.getUser?.(userId)?.username || fallback.username || null;
function channelLabel(ch) {
  if (!ch) return null;
  if (ch.name) return ch.name;
  const ids = ch.recipients || ch.rawRecipients?.map((r) => r.id) || [];
  return ids.map((id) => { const u = UserStore?.getUser?.(id); return u?.globalName || u?.username; }).filter(Boolean).join(", ") || L("Grupo", "Group");
}
const isFriendOf = (id) => safe(() => (RelationshipStore ? !!RelationshipStore.isFriend(id) : null));

/*
 * Abrir DM. Bug da v1.2: openPrivateChannel(userId) com o formato novo do Discord
 * criava um grupo vazio. Agora: usa a DM existente pelo usuário ou o ID do canal
 * que veio no sinal de digitação; openPrivateChannel só no formato { recipientIds }.
 */
function openDM(channelId, userId, isGroup) {
  try {
    if (!isGroup && userId) {
      const dm = ChannelStore?.getDMFromUserId?.(userId);
      if (dm && transitionTo) return transitionTo(`/channels/@me/${dm}`);
    }
    if (channelId && ChannelStore?.getChannel?.(channelId) && transitionTo) return transitionTo(`/channels/@me/${channelId}`);
    if (!isGroup && userId && PrivateChannelActions) {
      const src = String(PrivateChannelActions.openPrivateChannel);
      diag.openDM = src.slice(0, 300); saveDiag();
      if (/recipientIds/.test(src)) return PrivateChannelActions.openPrivateChannel({ recipientIds: [userId] });
    }
    if (channelId && transitionTo) return transitionTo(`/channels/@me/${channelId}`);
  } catch (e) { Logger.error(e); }
  toast(L("Não consegui abrir a DM.", "Couldn't open the DM."), { type: "error" });
}
function jumpTo(guildId, channelId, messageId) {
  try { if (transitionTo) return transitionTo(`/channels/${guildId || "@me"}/${channelId}${messageId ? `/${messageId}` : ""}`); } catch (e) { Logger.error(e); }
}

const pad = (n) => String(n).padStart(2, "0");
const fmtTime = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const fmtHM = (ms) => fmtTime(ms).slice(0, 5);
const fmtDate = (ms) => { const d = new Date(ms); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${fmtTime(ms)}`; };
function fmtSecs(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return `${m}min${r ? ` ${r}s` : ""}`;
  const hh = Math.floor(m / 60);
  if (hh < 48) return `${hh}h${m % 60 ? ` ${m % 60}min` : ""}`;
  return L(`${Math.floor(hh / 24)} dias`, `${Math.floor(hh / 24)} days`);
}
function fmtDur(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (m < 60) return `${m} min`;
  const hh = Math.floor(m / 60);
  if (hh < 48) return `${hh}h${m % 60 ? ` ${m % 60}min` : ""}`;
  return L(`${Math.floor(hh / 24)} dias`, `${Math.floor(hh / 24)} days`);
}
function attemptRange(a) {
  const base = a.lastTypingAt - a.startedAt;
  if ((a.signals || 1) <= 1 || base < 1000) return [0, 10000];
  return [base, base + 10000];
}
const attemptsOf = (r) => r.attempts || [attemptOf(r)];
const recordRange = (r) => attemptsOf(r).reduce(([lo, hi], a) => { const [l, x] = attemptRange(a); return [lo + l, hi + x]; }, [0, 0]);
const fmtRange = ([lo, hi]) => (lo < 1000 ? L(`por até ~${fmtSecs(hi)}`, `for up to ~${fmtSecs(hi)}`) : L(`entre ${fmtSecs(lo)} e ${fmtSecs(hi)}`, `for ${fmtSecs(lo)}–${fmtSecs(hi)}`));
const fmtRangeShort = ([lo, hi]) => (lo < 1000 ? L(`até ${fmtSecs(hi)}`, `up to ${fmtSecs(hi)}`) : `${fmtSecs(lo)}–${fmtSecs(hi)}`);

const DAY = 86400000;
const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
function relTime(ms) {
  const diff = Date.now() - ms;
  if (diff < 60000) return L("agora", "now");
  if (diff < 3600000) return L(`há ${Math.floor(diff / 60000)} min`, `${Math.floor(diff / 60000)} min ago`);
  const today = startOfDay(Date.now());
  if (ms >= today) return fmtHM(ms);
  if (ms >= today - DAY) return L("ontem", "yesterday");
  const d = new Date(ms);
  return L(`${pad(d.getDate())}/${pad(d.getMonth() + 1)}`, `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`);
}
function dayLabel(ms) {
  const today = startOfDay(Date.now());
  const day = startOfDay(ms);
  if (day === today) return L("Hoje", "Today");
  if (day === today - DAY) return L("Ontem", "Yesterday");
  const s = new Date(ms).toLocaleDateString(dateLocale(), { weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function groupByDay(items, getTime) {
  const days = [];
  for (const it of items) {
    const label = dayLabel(getTime(it));
    if (!days.length || days[days.length - 1].label !== label) days.push({ label, items: [] });
    days[days.length - 1].items.push(it);
  }
  return days;
}

/* ---------- presença ---------- */
// rótulos traduzidos na hora (Proxy: STATUS_PT.online etc.)
const labelMap = (pt, en) => new Proxy({}, { get: (_, key) => (lang() === "pt" ? pt : en)[key] });
const STATUS_PT = labelMap(
  { online: "Online", idle: "Ausente", dnd: "Não perturbar", offline: "Offline", invisible: "Invisível", streaming: "Transmitindo", unknown: "Sem status" },
  { online: "Online", idle: "Idle", dnd: "Do Not Disturb", offline: "Offline", invisible: "Invisible", streaming: "Streaming", unknown: "No status" });
const DEVICE_PT = labelMap(
  { desktop: "PC", mobile: "Celular", web: "Navegador", embedded: "Console", vr: "VR" },
  { desktop: "Desktop", mobile: "Mobile", web: "Browser", embedded: "Console", vr: "VR" });
function rawPresence(userId) {
  if (!PresenceStore) return null;
  try {
    const status = PresenceStore.getStatus?.(userId) || "offline";
    const cs = PresenceStore.getClientStatus?.(userId) || PresenceStore.getState?.()?.clientStatuses?.[userId] || {};
    return { status, devices: Object.keys(cs).filter((d) => cs[d] && cs[d] !== "offline") };
  } catch { return null; }
}
const presenceOf = (userId) => (getSettings().recordPresence ? rawPresence(userId) : null);
// O Discord sempre manda o status dos AMIGOS. Amigo digitando/enviando e aparecendo
// offline = conectado e invisível, com certeza. Para quem não é amigo não há status.
function effectiveStatus(p, isFriend) {
  if (!p?.status) return null;
  if (p.status !== "offline") return p.status;
  if (isFriend) return "invisible";
  if (isFriend === false) return "unknown";
  return "offline";
}
function fmtPresence(p, isFriend) {
  const st = effectiveStatus(p, isFriend);
  if (!st) return null;
  const dev = (p.devices || []).map((d) => DEVICE_PT[d] || d).join(", ");
  return `${STATUS_PT[st] || st}${dev ? ` (${dev})` : ""}`;
}
const fmtDevices = (devices) => (devices || []).map((d) => DEVICE_PT[d] || d).join(", ");
const lastPresence = (r) => { const a = attemptsOf(r); const x = a[a.length - 1]; return x?.presenceEnd || x?.presence || null; };
const recordInvisible = (r) => attemptsOf(r).some((a) => effectiveStatus(a.presence, r.isFriend) === "invisible" || effectiveStatus(a.presenceEnd, r.isFriend) === "invisible");

/* ---------- som ---------- */
const SOUND_FILE = "LurkSound";
const getCustomSound = () => safe(() => RawData.load(SOUND_FILE, "file"));
function playBeep(volume) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, volume / 100)) * 0.3;
    gain.connect(ctx.destination);
    [0, 0.14].forEach((t, i) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = i ? 660 : 880;
      o.connect(gain);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.1);
    });
    setTimeout(() => ctx.close(), 600);
  } catch {}
}
function playDiscordSound(name, vol) {
  if (!SoundUtils) throw new Error("módulo de som do Discord não encontrado");
  if (SoundUtils.play) { SoundUtils.play(name, vol / 100); return "play"; }
  const snd = SoundUtils.create(name, undefined, vol / 100);
  if (snd && "volume" in snd) snd.volume = vol / 100;
  snd?.play?.();
  return "create";
}
function playSound() {
  const s = getSettings();
  const vol = Math.max(0, Math.min(100, Number(s.soundVolume) || 0));
  try {
    if (s.soundSource === "discord") {
      try {
        diag.sound = { via: SoundUtils?.via || null, fn: playDiscordSound(s.discordSound || "message1", vol), name: s.discordSound };
        saveDiag();
        return;
      } catch (e) {
        diag.sound = { error: String(e?.message || e), via: SoundUtils?.via || null };
        saveDiag();
        toast(L("Não consegui tocar o som do Discord; tocando o bip.", "Couldn't play the Discord sound; playing the beep instead."), { type: "warning" });
      }
    }
    if (s.soundSource === "custom") {
      const f = getCustomSound();
      if (f?.data) {
        const a = new Audio(f.data);
        a.volume = vol / 100;
        a.play().catch(() => playBeep(vol));
        return;
      }
    }
  } catch (e) { Logger.error("som", e); }
  playBeep(vol);
}

/* ---------- avisos ---------- */
function isPlaying() {
  try {
    if (RunningGameStore?.getVisibleGame?.() || RunningGameStore?.getRunningGames?.()?.length) return true;
    return (PresenceStore?.getActivities?.(myId()) || []).some((a) => a?.type === 0);
  } catch { return false; }
}
// Modo foco (opcional): silencia os avisos, mas continua registrando tudo
function focusActive() {
  const s = getSettings();
  if (!s.focusMode) return false;
  const me = myId();
  const myStatus = safe(() => SelfPresenceStore?.getStatus?.()) || safe(() => PresenceStore?.getStatus?.(me));
  if (s.focusOnDnd && myStatus === "dnd") return true;
  if (s.focusWhilePlaying && isPlaying()) return true;
  return false;
}
function notify({ title, text, icon, onClick, toast: toastOn, desktop, sound }) {
  if (!(toastOn || desktop || sound) || focusActive()) return;
  if (toastOn) toast(text, { type: "info", timeout: 6000 });
  if (desktop) {
    try {
      const n = new Notification(title, { body: text, icon, silent: true });
      if (onClick) n.onclick = () => { try { window.focus(); } catch {} onClick(); };
    } catch {}
  }
  if (sound) playSound();
}

function saveFile(name, content, mime) {
  try {
    if (window.DiscordNative?.fileManager?.saveWithDialog) {
      window.DiscordNative.fileManager.saveWithDialog(new TextEncoder().encode(content), name);
      return;
    }
  } catch {}
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const csvEsc = (v) => { const s = v == null ? "" : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (head, rows) => "﻿" + [head.join(","), ...rows.map((r) => r.map(csvEsc).join(","))].join("\n");
const KIND_LABEL = labelMap({ dm: "DM", group: "Grupo", unknown: "DM oculta", guild: "Servidor" }, { dm: "DM", group: "Group", unknown: "Hidden DM", guild: "Server" });
const whereOf = (r) => (r.channelType === "guild" ? `#${r.channelName || L("canal", "channel")} · ${r.guildName || L("servidor", "server")}` : r.channelType === "group" ? (r.groupName || L("Grupo", "Group")) : null);
function typingCsv(rows) {
  return toCsv(
    L(["nome", "usuario", "user_id", "amigo", "tipo", "onde", "tentativas", "inicio", "parou", "tempo_digitando", "status_presenca", "status", "enviou_em"],
      ["name", "username", "user_id", "friend", "type", "where", "attempts", "started", "stopped", "typing_time", "presence", "status", "sent_at"]),
    rows.map((r) => [
      displayName(r), r.username, r.userId, r.isFriend == null ? "" : r.isFriend ? L("sim", "yes") : L("não", "no"),
      KIND_LABEL[r.channelType] || r.channelType, whereOf(r) || "", attemptsOf(r).length,
      fmtDate(r.startedAt), fmtDate(r.lastTypingAt), fmtRange(recordRange(r)),
      [...new Set(attemptsOf(r).map((a) => fmtPresence(a.presence, r.isFriend)).filter(Boolean))].join(" | "),
      r.status === "sent_later" ? L("Enviou depois", "Sent later") : L("Não enviou", "Not sent"), r.sentLaterAt ? fmtDate(r.sentLaterAt) : "",
    ]));
}

/* ================================================================== */
/* Rastreamento de digitação                                            */
/* ================================================================== */
const sessions = new Map();    // "canal:usuario" -> digitando agora
const pendingSent = new Map(); // "canal:usuario" -> janela do "enviou depois"
const invisibleThrottle = new Map();

function classify(channelId, userId) {
  const ch = ChannelStore?.getChannel?.(channelId);
  if (!ch) return { kind: "unknown" };
  if (ch.guild_id) {
    if (isVip(userId) && getSettings().vipTrackServers) return { kind: "guild", ch };
    return null;
  }
  if (ch.type === 1) return { kind: "dm", ch };
  if (ch.type === 3) return { kind: "group", ch };
  return null;
}
function guildInfo(ch) {
  return { guildId: ch?.guild_id || null, guildName: safe(() => GuildStore?.getGuild?.(ch?.guild_id)?.name) || null, channelName: ch?.name || null };
}

// VIP amigo agindo enquanto aparece offline = pego invisível
function checkInvisible(userId, via, where) {
  if (!isVip(userId) || !isFriendOf(userId)) return;
  const p = rawPresence(userId);
  if (!p || p.status !== "offline") return;
  const last = invisibleThrottle.get(userId) || 0;
  if (Date.now() - last < 5 * 60000) return;
  invisibleThrottle.set(userId, Date.now());
  addVipEvent({ type: "invisible", userId, at: Date.now(), via, where: where || null });
  const s = getSettings();
  if (vipFlag(userId, "notifyInvisible")) {
    notify({
      title: L("Lista VIP", "VIP list"), text: L(`${nameOf(userId)} está invisível (${via === "typing" ? "digitando" : "mandou mensagem"}${where ? ` em ${where}` : ""})`, `${nameOf(userId)} is invisible (${via === "typing" ? "typing" : "sent a message"}${where ? ` in ${where}` : ""})`),
      icon: avatarOf(UserStore?.getUser?.(userId), userId), toast: s.vipToast, desktop: s.vipDesktop, sound: s.vipSound,
    });
  }
}

function onTypingStart(action) {
  try {
    const { channelId, userId } = action || {};
    if (!channelId || !userId || userId === myId()) return;
    const info = classify(channelId, userId);
    if (!info) return;
    const s = getSettings();
    if (info.kind === "group" && !s.trackGroupDMs) return;
    if (info.kind === "unknown" && !s.trackUnknownChannels) return;
    if (isIgnoredUser(userId) || isIgnoredChannel(channelId)) return;

    diag.typingEvents = [{ at: Date.now(), channelId, userId, kind: info.kind }, ...diag.typingEvents].slice(0, 15);
    saveDiag();

    const key = `${channelId}:${userId}`;
    const now = Date.now();
    let sess = sessions.get(key);
    const isNew = !sess;
    if (!sess) {
      const p = presenceOf(userId);
      sess = { key, channelId, userId, kind: info.kind, startedAt: now, lastTypingAt: now, signals: 0, timer: null, presence: p, presenceEnd: p };
      sessions.set(key, sess);
    } else {
      sess.presenceEnd = presenceOf(userId);
    }
    sess.lastTypingAt = now;
    sess.signals += 1;
    clearTimeout(sess.timer);
    sess.timer = setTimeout(() => endSession(key, true), TYPING_TIMEOUT);
    liveBus.emit();

    if (isNew) onSessionStart(sess, info);
  } catch (e) { Logger.error("TYPING_START", e); }
}

function onSessionStart(sess, info) {
  const s = getSettings();
  const u = UserStore?.getUser?.(sess.userId);
  const name = nameOf(sess.userId);
  const icon = avatarOf(u, sess.userId);
  const where = info.kind === "guild" ? `#${info.ch?.name || L("canal", "channel")} (${guildInfo(info.ch).guildName || L("servidor", "server")})`
    : info.kind === "group" ? L(`o grupo ${channelLabel(info.ch)}`, `the group ${channelLabel(info.ch)}`) : null;
  const startText = L(`${name} começou a digitar ${where ? `em ${where}` : "pra você"}...`, `${name} started typing ${where ? `in ${where}` : "to you"}...`);
  const vipTyping = vipFlag(sess.userId, "notifyTyping");

  if (info.kind !== "guild" && (s.startToast || s.startDesktop || s.startSound)) {
    notify({
      title: L("Começou a digitar", "Started typing"), text: startText, icon,
      onClick: () => openDM(sess.channelId, sess.userId, info.kind === "group"),
      toast: s.startToast, desktop: s.startDesktop, sound: s.startSound,
    });
  } else if (vipTyping) {
    notify({
      title: L("Lista VIP", "VIP list"), text: startText, icon,
      onClick: () => (info.kind === "guild" ? jumpTo(info.ch.guild_id, sess.channelId) : openDM(sess.channelId, sess.userId, info.kind === "group")),
      toast: s.vipToast, desktop: s.vipDesktop, sound: s.vipSound,
    });
  }
  checkInvisible(sess.userId, "typing", info.kind === "guild" && info.ch?.name ? `#${info.ch.name}` : null);
}

function onMessageCreate(action) {
  try {
    const msg = action?.message;
    if (!msg?.author?.id || action.optimistic) return;
    const channelId = action.channelId || msg.channel_id;
    const userId = msg.author.id;
    const key = `${channelId}:${userId}`;
    if (sessions.has(key)) endSession(key, false); // enviou: descarta
    else {
      const pend = pendingSent.get(key);
      if (pend) {
        clearTimeout(pend.timer);
        pendingSent.delete(key);
        updateRecord(pend.recordId, { status: "sent_later", sentLaterAt: Date.now() });
      }
    }
    const ch = ChannelStore?.getChannel?.(channelId);
    const gid = action.guildId || msg.guild_id || ch?.guild_id || null;
    if (userId === myId()) {
      if (!gid && ch?.type === 1) (ch.recipients || []).forEach(rememberContact);
      return;
    }
    if (!gid && (!ch || ch.type === 1)) rememberContact(userId); // mandou mensagem: já não é "primeiro contato"
    if (isVip(userId)) {
      const s = getSettings();
      if (s.vipRecordMessages && (gid || s.vipRecordDMs)) recordVipMessage(msg, channelId, gid, ch);
      checkInvisible(userId, "message", gid && ch?.name ? `#${ch.name}` : null);
    }
    handleMentionCreate(msg, channelId, gid, ch);
  } catch (e) { Logger.error("MESSAGE_CREATE", e); }
}

function recordVipMessage(msg, channelId, guildId, ch) {
  const gid = guildId;
  const d = loadVip();
  if (d.messages.some((m) => m.id === msg.id)) return;
  const max = Math.max(100, Number(getSettings().vipMaxMessages) || DEFAULTS.vipMaxMessages);
  d.messages = [{
    id: msg.id,
    userId: msg.author.id,
    guildId,
    channelId,
    guildName: safe(() => GuildStore?.getGuild?.(guildId)?.name) || null,
    channelName: gid ? (ch?.name || null) : (ch?.type === 3 ? channelLabel(ch) : null),
    isDM: !guildId,
    content: msg.content || "",
    attachments: (msg.attachments || []).map((a) => ({ name: a.filename, url: a.url, type: a.content_type || null })),
    stickers: (msg.sticker_items || msg.stickerItems || []).map((s) => s.name),
    createdAt: Date.parse(msg.timestamp) || Date.now(),
    edits: [],
    deletedAt: null,
  }, ...d.messages].slice(0, max);
  saveVipSoon();
}
function onMessageUpdate(action) {
  try {
    const msg = action?.message;
    if (!msg?.id) return;
    handleMentionUpdate(msg);
    if (typeof msg.content !== "string") return;
    const d = loadVip();
    const m = d.messages.find((x) => x.id === msg.id);
    if (!m) return;
    const last = m.edits.length ? m.edits[m.edits.length - 1].content : m.content;
    if (last === msg.content) return;
    m.edits.push({ at: Date.parse(msg.edited_timestamp) || Date.now(), content: msg.content });
    saveVipSoon();
  } catch (e) { Logger.error("MESSAGE_UPDATE", e); }
}
function markDeleted(ids) {
  const d = loadVip();
  let changed = false;
  for (const m of d.messages) {
    if (!m.deletedAt && ids.includes(m.id)) { m.deletedAt = Date.now(); changed = true; }
  }
  if (changed) saveVipSoon();
}
const onMessageDelete = (a) => { try { if (a?.id) { markDeleted([a.id]); handleMentionDelete([a.id]); } } catch (e) { Logger.error("MESSAGE_DELETE", e); } };
const onMessageDeleteBulk = (a) => { try { if (a?.ids?.length) { markDeleted(a.ids); handleMentionDelete(a.ids); } } catch (e) { Logger.error("MESSAGE_DELETE_BULK", e); } };

/* ================================================================== */
/* Menções: ghost ping, resposta apagada, palavras-chave, reações       */
/* ================================================================== */
const mentionCache = new Map();  // id da mensagem -> snapshot (mensagens que te mencionam/respondem)
const reactionCache = new Map(); // "msg:usuario:emoji" -> quando reagiu
const CACHE_TTL = 24 * 3600000;

function placeOf(guildId, channelId) {
  const ch = ChannelStore?.getChannel?.(channelId);
  const gid = guildId || ch?.guild_id || null;
  return {
    guildId: gid,
    channelId,
    guildName: gid ? safe(() => GuildStore?.getGuild?.(gid)?.name) || null : null,
    channelName: gid ? (ch?.name || null) : (ch?.type === 3 ? channelLabel(ch) : null),
  };
}
const placeLabel = (e) => (e.guildId ? `#${e.channelName || L("canal", "channel")} · ${e.guildName || L("servidor", "server")}` : e.channelName ? L(`Grupo ${e.channelName}`, `Group ${e.channelName}`) : L("Privado", "DM"));
function trimCache(map) {
  const now = Date.now();
  for (const [key, v] of map) { if (now - (v.cachedAt || 0) > CACHE_TTL || map.size > 3000) map.delete(key); else break; }
}
const normalize = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function keywordList() {
  return String(getSettings().keywords || "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
}
function findKeyword(content) {
  const text = normalize(content);
  if (!text) return null;
  for (const kw of keywordList()) {
    const n = normalize(kw).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${n}($|[^\\p{L}\\p{N}])`, "u").test(text)) return kw;
  }
  return null;
}
function isGuildMuted(gid) { return !!safe(() => UserGuildSettingsStore?.isMuted?.(gid)); }

function handleMentionCreate(msg, channelId, gid, ch) {
  const s = getSettings();
  const me = myId();
  const author = msg.author;
  const mentionsMe = (msg.mentions || []).some((u) => (u?.id || u) === me);
  const refId = msg.message_reference?.message_id || msg.messageReference?.message_id;
  const refAuthor = msg.referenced_message?.author?.id
    || (refId ? safe(() => MessageStore?.getMessage?.(msg.message_reference?.channel_id || channelId, refId)?.author?.id) : null);
  const repliesMe = refAuthor === me;
  if ((repliesMe && s.mentionReply) || (mentionsMe && !repliesMe && s.mentionGhost)) {
    trimCache(mentionCache);
    mentionCache.set(msg.id, {
      cachedAt: Date.now(),
      kind: repliesMe ? "reply" : "ghost",
      messageId: msg.id,
      ...snapshotUser(author.id, author),
      ...placeOf(gid, channelId),
      content: msg.content || "",
      attachments: (msg.attachments || []).map((a) => a.filename),
      createdAt: Date.parse(msg.timestamp) || Date.now(),
      replyTo: repliesMe ? (msg.referenced_message?.content || safe(() => MessageStore?.getMessage?.(channelId, refId)?.content) || null) : null,
    });
  }
  if (gid && !author.bot && keywordList().length && !(s.keywordIgnoreMuted && isGuildMuted(gid))) {
    const kw = findKeyword(msg.content);
    if (kw) {
      const ev = { type: "keyword", keyword: kw, messageId: msg.id, ...snapshotUser(author.id, author), ...placeOf(gid, channelId), content: msg.content || "", createdAt: Date.parse(msg.timestamp) || Date.now() };
      addMentionEvent(ev);
      notify({
        title: L(`Palavra-chave: ${kw}`, `Keyword: ${kw}`), text: L(`${nameOf(author.id, ev)} em ${placeLabel(ev)}: `, `${nameOf(author.id, ev)} in ${placeLabel(ev)}: `) + String(msg.content).slice(0, 140),
        icon: ev.avatarURL, onClick: () => jumpTo(gid, channelId, msg.id),
        toast: s.keywordToast, desktop: s.keywordDesktop, sound: s.keywordSound,
      });
    }
  }
}
function handleMentionUpdate(msg) {
  const c = mentionCache.get(msg.id);
  if (!c || c.kind !== "ghost" || !Array.isArray(msg.mentions)) return;
  if (msg.mentions.some((u) => (u?.id || u) === myId())) return;
  mentionCache.delete(msg.id);
  pushMentionEvent({ ...c, type: "ghost", edited: true, newContent: msg.content ?? null, deletedAt: Date.now() });
}
function handleMentionDelete(ids) {
  for (const id of ids) {
    const c = mentionCache.get(id);
    if (!c) continue;
    mentionCache.delete(id);
    pushMentionEvent({ ...c, type: c.kind, deletedAt: Date.now() });
  }
}
function pushMentionEvent(ev) {
  delete ev.kind; delete ev.cachedAt;
  addMentionEvent(ev);
  const s = getSettings();
  const who = nameOf(ev.userId, ev);
  const lived = fmtDur((ev.deletedAt || Date.now()) - (ev.createdAt || Date.now()));
  const where = placeLabel(ev);
  const text = ev.type === "reply"
    ? L(`${who} respondeu você e apagou depois de ${lived} em ${where}`, `${who} replied to you and deleted it after ${lived} in ${where}`)
    : ev.edited ? L(`${who} te marcou e tirou a menção editando, depois de ${lived}, em ${where}`, `${who} pinged you and edited the mention out after ${lived} in ${where}`)
    : L(`${who} te marcou e apagou depois de ${lived} em ${where}`, `${who} pinged you and deleted it after ${lived} in ${where}`);
  notify({ title: ev.type === "reply" ? L("Resposta apagada", "Deleted reply") : "Ghost ping", text, icon: ev.avatarURL, onClick: () => jumpTo(ev.guildId, ev.channelId),
    toast: s.mentionToast, desktop: s.mentionDesktop, sound: s.mentionSound });
}

const emojiKey = (e) => e?.id || e?.name || "?";
function onReactionAdd(a) {
  try {
    if (!getSettings().mentionReaction || !a?.userId || a.userId === myId()) return;
    const msg = safe(() => MessageStore?.getMessage?.(a.channelId, a.messageId));
    const author = a.messageAuthorId || msg?.author?.id;
    if (author !== myId()) return;
    trimCache(reactionCache);
    reactionCache.set(`${a.messageId}:${a.userId}:${emojiKey(a.emoji)}`, {
      cachedAt: Date.now(), addedAt: Date.now(), emoji: a.emoji ? { id: a.emoji.id || null, name: a.emoji.name || null, animated: !!a.emoji.animated } : null,
      channelId: a.channelId, messageId: a.messageId, guildId: a.guildId || null, myContent: msg?.content || null,
    });
  } catch (e) { Logger.error("REACTION_ADD", e); }
}
function onReactionRemove(a) {
  try {
    const key = `${a?.messageId}:${a?.userId}:${emojiKey(a?.emoji)}`;
    const c = reactionCache.get(key);
    if (!c) return;
    reactionCache.delete(key);
    const ev = { type: "reaction", messageId: c.messageId, ...snapshotUser(a.userId), ...placeOf(c.guildId, c.channelId), emoji: c.emoji, myContent: c.myContent, createdAt: c.addedAt, deletedAt: Date.now() };
    addMentionEvent(ev);
    const s = getSettings();
    notify({
      title: L("Reação removida", "Reaction removed"), text: L(`${nameOf(a.userId, ev)} reagiu ${c.emoji?.id ? `:${c.emoji.name}:` : c.emoji?.name || ""} na sua mensagem e tirou ${fmtDur(ev.deletedAt - ev.createdAt)} depois`, `${nameOf(a.userId, ev)} reacted ${c.emoji?.id ? `:${c.emoji.name}:` : c.emoji?.name || ""} to your message and removed it ${fmtDur(ev.deletedAt - ev.createdAt)} later`),
      icon: ev.avatarURL, onClick: () => jumpTo(ev.guildId, ev.channelId, ev.messageId),
      toast: s.mentionToast, desktop: s.mentionDesktop, sound: s.mentionSound,
    });
  } catch (e) { Logger.error("REACTION_REMOVE", e); }
}

/* ================================================================== */
/* Voz dos VIPs                                                         */
/* ================================================================== */
const vipVoice = new Map(); // userId -> sessão aberta
function usersInChannel(channelId) {
  const st = safe(() => VoiceStateStore?.getVoiceStatesForChannel?.(channelId)) || {};
  const vals = st instanceof Map ? [...st.values()] : Object.values(st);
  return vals.map((v) => v?.userId).filter(Boolean);
}
function openVoice(userId, vs, already) {
  const now = Date.now();
  const present = usersInChannel(vs.channelId).filter((id) => id !== userId && id !== undefined);
  const sess = {
    userId, ...placeOf(vs.guildId, vs.channelId), joinedAt: now, already: !!already,
    peers: new Set(present),
    peerLog: Object.fromEntries(present.map((id) => [id, { joinedAt: now, leftAt: null, already: true }])),
    events: [],
    muted: false, deafened: false, streamed: false, video: false,
  };
  applyVoiceFlags(sess, vs);
  vipVoice.set(userId, sess);
  vipBus.emit();
  return sess;
}
function closeVoice(userId, cut) {
  const v = vipVoice.get(userId);
  if (!v) return;
  vipVoice.delete(userId);
  const d = loadVip();
  delete v.now;
  const end = Date.now();
  const peers = [...v.peers].map((id) => {
    const u = UserStore?.getUser?.(id);
    const log = v.peerLog?.[id] || {};
    return { id, name: nameOf(id), username: u?.username || null, avatarURL: avatarOf(u, id), joinedAt: log.joinedAt || v.joinedAt, leftAt: log.leftAt || null, already: !!log.already };
  });
  delete v.peerLog;
  d.voice = [{ ...v, peers, leftAt: end, cut: !!cut }, ...(d.voice || [])].slice(0, 3000);
  saveVipSoon();
}
function initVoiceFor(id) {
  if (!getSettings().vipTrackVoice) return;
  const vs = normVS(safe(() => VoiceStateStore?.getVoiceStateForUser?.(id)));
  if (vs?.channelId) openVoice(id, { ...vs, userId: id }, true);
}
function initVoice() {
  vipVoice.clear();
  for (const id of Object.keys(getVipList())) initVoiceFor(id);
}
// O Discord às vezes manda os campos em camelCase, às vezes em snake_case
function normVS(vs) {
  if (!vs) return null;
  const pick = (a, b) => (vs[a] !== undefined ? vs[a] : vs[b]);
  return {
    userId: pick("userId", "user_id"),
    channelId: pick("channelId", "channel_id") || null,
    guildId: pick("guildId", "guild_id") || null,
    mute: !!vs.mute, deaf: !!vs.deaf,
    selfMute: !!pick("selfMute", "self_mute"), selfDeaf: !!pick("selfDeaf", "self_deaf"),
    selfStream: !!pick("selfStream", "self_stream"), selfVideo: !!pick("selfVideo", "self_video"),
  };
}
// junta o que veio no evento com o que o store de voz já tem (o store é a fonte mais confiável)
function mergedVS(raw) {
  const n = normVS(raw);
  if (!n?.userId) return n;
  const st = normVS(safe(() => VoiceStateStore?.getVoiceStateForUser?.(n.userId)));
  if (st && st.channelId === n.channelId) {
    for (const f of ["mute", "deaf", "selfMute", "selfDeaf", "selfStream", "selfVideo"]) n[f] = n[f] || st[f];
  }
  return n;
}
function onVoiceStates(action) {
  if (!diag.voiceSample && action?.voiceStates?.[0]) { diag.voiceSample = Object.keys(action.voiceStates[0]); saveDiag(); }
  const list = action?.voiceStates || [];
  setTimeout(() => { processVoiceStates(list); safe(() => processMyCall(list)); }, 0); // deixa o store de voz atualizar primeiro
}
function processVoiceStates(list) {
  try {
    if (!getSettings().vipTrackVoice) return;
    const s = getSettings();
    for (const raw of list) {
      const vs = mergedVS(raw);
      const uid = vs?.userId;
      if (!uid) continue;
      for (const v of vipVoice.values()) {
        if (uid === v.userId) continue;
        const log = (v.peerLog ||= {});
        if (vs.channelId && vs.channelId === v.channelId) {
          v.peers.add(uid);
          if (!log[uid] || log[uid].leftAt) log[uid] = { joinedAt: log[uid]?.joinedAt || Date.now(), leftAt: null, rejoined: !!log[uid] };
        } else if (log[uid] && !log[uid].leftAt) {
          log[uid].leftAt = Date.now();
        }
        vipBus.emit();
      }
      if (!isVip(uid)) continue;
      const cur = vipVoice.get(uid);
      if ((cur?.channelId || null) !== (vs.channelId || null)) {
        if (cur) closeVoice(uid);
        if (vs.channelId) {
          const v = openVoice(uid, vs, false);
          if (vipFlag(uid, "notifyVoice")) {
            notify({
              title: L("Lista VIP", "VIP list"), text: L(`${nameOf(uid)} entrou em call: ${placeLabel(v)}${v.peers.size ? ` (com ${v.peers.size} ${plural(v.peers.size, "pessoa", "pessoas")})` : ""}`, `${nameOf(uid)} joined a call: ${placeLabel(v)}${v.peers.size ? ` (with ${v.peers.size} ${plural(v.peers.size, "person", "people")})` : ""}`),
              icon: avatarOf(UserStore?.getUser?.(uid), uid), onClick: () => jumpTo(v.guildId, v.channelId),
              toast: s.vipToast, desktop: s.vipDesktop, sound: s.vipSound,
            });
          }
        }
      } else if (cur) {
        applyVoiceFlags(cur, vs);
        for (const pid of usersInChannel(cur.channelId)) {
          if (pid === uid) continue;
          cur.peers.add(pid);
          (cur.peerLog ||= {})[pid] ||= { joinedAt: Date.now(), leftAt: null };
        }
        vipBus.emit();
      }
    }
  } catch (e) { Logger.error("VOICE", e); }
}
function applyVoiceFlags(sess, vs) {
  const prev = sess.now || { muted: false, deafened: false, streamed: false, video: false };
  sess.now = { muted: !!(vs.selfMute || vs.mute), deafened: !!(vs.selfDeaf || vs.deaf), streamed: !!vs.selfStream, video: !!vs.selfVideo };
  for (const f of Object.keys(sess.now)) {
    if (sess.now[f] !== !!prev[f]) (sess.events ||= []).push({ at: Date.now(), flag: f, on: sess.now[f] });
  }
  sess.muted ||= sess.now.muted;
  sess.deafened ||= sess.now.deafened;
  sess.streamed ||= sess.now.streamed;
  sess.video ||= sess.now.video;
}

/* ================================================================== */
/* Digitação dos VIPs em servidores em comum                            */
/* ================================================================== */
// O Discord só manda "fulano está digitando" dos servidores que o cliente está acompanhando
// (os que você abriu). Aqui o plugin faz o mesmo pedido que o Discord faz ao abrir um
// servidor (gateway op 37, { typing: true }), só para os servidores em comum com seus VIPs.
const profileFetchedAt = new Map();
function ensureProfile(uid) {
  if (!ProfileActions) return;
  if (Date.now() - (profileFetchedAt.get(uid) || 0) < 30 * 60000) return;
  profileFetchedAt.set(uid, Date.now());
  try { const r = ProfileActions.fetchProfile(uid, { withMutualGuilds: true }); r?.catch?.(() => {}); } catch {}
}
function mutualGuildIds(uid) {
  const ids = new Set();
  for (const g of safe(() => UserProfileStore?.getMutualGuilds?.(uid)) || []) { const id = g?.guild?.id || g?.id; if (id) ids.add(id); }
  if (!ids.size) {
    const guilds = safe(() => GuildStore?.getGuilds?.()) || {};
    for (const gid of Object.keys(guilds)) if (safe(() => GuildMemberStore?.isMember?.(gid, uid))) ids.add(gid);
  }
  return [...ids];
}
function subscribeVipGuilds() {
  try {
    const s = getSettings();
    if (!s.vipTrackServers || !s.vipSubscribeTyping) return;
    const vips = Object.keys(getVipList());
    if (!vips.length) return;
    const gids = new Set();
    for (const id of vips) { ensureProfile(id); mutualGuildIds(id).forEach((g) => gids.add(g)); }
    const sock = safe(() => GatewayModule?.getSocket?.());
    diag.subscribe = { socket: !!sock, guilds: gids.size, at: new Date().toISOString() };
    if (sock && typeof sock.send === "function" && gids.size) {
      const subscriptions = {};
      for (const g of gids) subscriptions[g] = { typing: true };
      sock.send(37, { subscriptions });
      diag.subscribe.sent = true;
    }
    saveDiag();
  } catch (e) { diag.subscribe = { error: String(e?.message || e) }; saveDiag(); }
}
function scheduleSubscribe() {
  setTimeout(subscribeVipGuilds, 1500);
  setTimeout(subscribeVipGuilds, 8000); // depois que o perfil (servidores em comum) carregar
}

/* ================================================================== */
/* Backup                                                               */
/* ================================================================== */
const BACKUP_FILE = "LurkBackup";
const getBackups = () => safe(() => RawData.load(BACKUP_FILE, `list_${myId()}`)) || [];
function collectBackup() {
  flushVip(); flushMentions(); flushCalls();
  const v = loadVip(), m = loadMentions(), c = loadCalls();
  return {
    format: "Lurk-backup", v: 1, at: Date.now(), plugin: VERSION, account: myId(),
    data: {
      settings: Data.load("settings") || {}, history: Data.load(k("history")) || [], ignored: Data.load(k("ignored")) || null,
      vip: Data.load(k("vip")) || {}, reqCanceled: Data.load(k("reqCanceled")) || [], reqPending: Data.load(k("reqPending")) || {},
      vipEvents: v.events, vipMessages: v.messages, vipVoice: v.voice, mentions: m.events,
      calls: c.sessions, firstContacts: Data.load(k("firstContacts")) || [], knownContacts: Data.load(k("knownContacts")) || [],
    },
  };
}
function runBackup(force) {
  const s = getSettings();
  if (!force && !s.backupEnabled) return false;
  const list = getBackups();
  if (!force && list[0] && Date.now() - list[0].at < Math.max(1, Number(s.backupDays) || 7) * DAY) return false;
  const b = collectBackup();
  RawData.save(BACKUP_FILE, `list_${myId()}`, [b, ...list].slice(0, Math.max(1, Number(s.backupKeep) || 3)));
  backupBus.emit();
  return true;
}
function restoreBackup(b) {
  if (!b?.data || (b.format !== "Lurk-backup" && b.format !== "DMTypingTracker-backup")) throw new Error(L("Esse arquivo não é um backup do Lurk.", "This file isn't a Lurk backup."));
  runBackup(true); // cópia de segurança do estado atual antes de restaurar
  const D = b.data, me = myId();
  if (D.settings) Data.save("settings", D.settings);
  Data.save(k("history"), D.history || []);
  if (D.ignored) Data.save(k("ignored"), D.ignored);
  Data.save(k("vip"), D.vip || {});
  Data.save(k("reqCanceled"), D.reqCanceled || []);
  Data.save(k("reqPending"), D.reqPending || {});
  RawData.save(VIP_FILE, `events_${me}`, D.vipEvents || []);
  RawData.save(VIP_FILE, `messages_${me}`, D.vipMessages || []);
  RawData.save(VIP_FILE, `voice_${me}`, D.vipVoice || []);
  RawData.save(MENTION_FILE, `events_${me}`, D.mentions || []);
  RawData.save(CALL_FILE, `sessions_${me}`, D.calls || []);
  Data.save(k("firstContacts"), D.firstContacts || []);
  if (D.knownContacts) Data.save(k("knownContacts"), D.knownContacts);
  callData.owner = null; callData.dirty = false;
  settingsCache = null; historyCache = null; vipData.owner = null; vipData.dirty = false; mentionData.owner = null; mentionData.dirty = false;
  loadVip(); loadMentions(); loadCalls(); initPresenceCache(); initVoice(); initKnownContacts();
  [historyBus, vipBus, reqBus, mentionBus, settingsBus, backupBus, callBus].forEach((b2) => b2.emit());
  updateBadge();
}

function endSession(key, register) {
  const sess = sessions.get(key);
  if (!sess) return;
  clearTimeout(sess.timer);
  sessions.delete(key);
  liveBus.emit();
  if (!register) return;
  if (sess.kind === "dm" || sess.kind === "unknown") safe(() => checkFirstContact(sess));

  const s = getSettings();
  if ((sess.lastTypingAt - sess.startedAt) / 1000 < (Number(s.minDuration) || 0)) return;

  const u = UserStore?.getUser?.(sess.userId);
  const ch = ChannelStore?.getChannel?.(sess.channelId);
  let isRequest = false;
  try { isRequest = !!MessageRequestStore?.isMessageRequest?.(sess.channelId); } catch {}

  const identity = {
    username: u?.username ?? null,
    globalName: u?.globalName ?? u?.global_name ?? null,
    avatarURL: avatarOf(u, sess.userId),
    channelType: sess.kind === "guild" ? "guild" : ch ? (ch.type === 3 ? "group" : "dm") : sess.kind,
    groupName: ch?.type === 3 ? channelLabel(ch) : null,
    ...(sess.kind === "guild" ? guildInfo(ch) : {}),
    isFriend: isFriendOf(sess.userId),
    isMessageRequest: isRequest,
  };
  const attempt = { startedAt: sess.startedAt, lastTypingAt: sess.lastTypingAt, signals: sess.signals, presence: sess.presence, presenceEnd: sess.presenceEnd };

  const hist = getHistory();
  const idx = hist.findIndex((r) => r.userId === sess.userId && r.channelId === sess.channelId);
  const prev = idx >= 0 ? hist[idx] : null;
  const mergeMs = (Number(s.mergeWindow) || 0) * 1000;
  let rec, merged = false;

  if (prev && prev.status === "not_sent" && mergeMs > 0 && sess.startedAt - prev.lastTypingAt <= mergeMs) {
    rec = { ...prev, ...identity, attempts: [...attemptsOf(prev), attempt], lastTypingAt: attempt.lastTypingAt, signals: (prev.signals || 0) + attempt.signals };
    merged = true;
    saveHistory(trim([rec, ...hist.filter((_, i) => i !== idx)]));
  } else {
    rec = {
      v: 2, id: `${sess.startedAt}-${sess.userId}`, userId: sess.userId, channelId: sess.channelId, ...identity,
      startedAt: sess.startedAt, lastTypingAt: sess.lastTypingAt, signals: sess.signals, attempts: [attempt],
      status: "not_sent", sentLaterAt: null,
    };
    saveHistory(trim([rec, ...hist]));
  }

  const win = Math.max(0, Number(s.sentLaterWindow) || 0) * 60000;
  const old = pendingSent.get(key);
  if (old) clearTimeout(old.timer);
  pendingSent.delete(key);
  if (win > 0) pendingSent.set(key, { recordId: rec.id, timer: setTimeout(() => pendingSent.delete(key), win) });

  if (!merged || s.notifyEachAttempt) {
    const n = attemptsOf(rec).length;
    const where = whereOf(rec);
    notify({
      title: L("Digitou e apagou", "Typed & quit"),
      text: L(`${displayName(rec)} digitou ${fmtRange(recordRange(rec))}${where ? ` em ${where}` : " pra você"} e não enviou${n > 1 ? ` (${n} tentativas)` : ""}`, `${displayName(rec)} typed ${fmtRange(recordRange(rec))}${where ? ` in ${where}` : " to you"} and didn't send${n > 1 ? ` (${n} attempts)` : ""}`),
      icon: rec.avatarURL,
      onClick: () => (rec.channelType === "guild" ? jumpTo(rec.guildId, rec.channelId) : openDM(rec.channelId, rec.userId, rec.channelType === "group")),
      toast: s.notifyToast, desktop: s.notifyDesktop, sound: s.notifySound,
    });
  }
}

/* ================================================================== */
/* Presença dos VIPs (linha do tempo online/offline)                    */
/* ================================================================== */
const presenceCache = new Map();
function initPresenceCache() {
  presenceCache.clear();
  for (const id of Object.keys(getVipList())) presenceCache.set(id, rawPresence(id));
}
function onPresenceChange() {
  try {
    const list = getVipList();
    const s = getSettings();
    for (const id of Object.keys(list)) {
      const p = rawPresence(id);
      if (!p) continue;
      const prev = presenceCache.get(id);
      presenceCache.set(id, p);
      if (!prev || prev.status === p.status) continue;
      addVipEvent({ type: "presence", userId: id, at: Date.now(), from: prev.status, to: p.status, devices: p.devices });
      if (prev.status === "offline" && vipFlag(id, "notifyOnline")) {
        notify({
          title: L("Lista VIP", "VIP list"), text: L(`${nameOf(id, list[id])} ficou ${STATUS_PT[p.status] || p.status}`, `${nameOf(id, list[id])} is now ${STATUS_PT[p.status] || p.status}`) + (p.devices?.length ? ` (${fmtDevices(p.devices)})` : ""),
          icon: avatarOf(UserStore?.getUser?.(id), id), onClick: () => openVip(id),
          toast: s.vipToast, desktop: s.vipDesktop, sound: s.vipSound,
        });
      }
    }
  } catch (e) { Logger.error("presence", e); }
}

/* ================================================================== */
/* Pedidos de amizade cancelados                                         */
/* ================================================================== */
const REL_PENDING_INCOMING = 3;
const REL_FRIEND = 1;
const declinedByMe = new Map(); // ids que você recusou/cancelou (pra não confundir com "a pessoa cancelou")

function relEntries() {
  const raw = safe(() => RelationshipStore?.getMutableRelationships?.()) || safe(() => RelationshipStore?.getRelationships?.()) || {};
  const entries = raw instanceof Map ? [...raw.entries()] : Object.entries(raw);
  return entries.map(([id, v]) => [id, typeof v === "number" ? v : v?.type]);
}
function snapshotUser(id, user) {
  const u = UserStore?.getUser?.(id) || user;
  return {
    userId: id,
    username: u?.username ?? null,
    globalName: u?.globalName ?? u?.global_name ?? null,
    avatarURL: u?.getAvatarURL ? avatarOf(u, id) : u?.avatar ? `https://cdn.discordapp.com/avatars/${id}/${u.avatar}.webp?size=128` : defaultAvatar(u, id),
  };
}
function initPendingReqs() {
  if (!getSettings().friendReqTrack) return;
  const rels = relEntries();
  const typeOf = new Map(rels);
  const pending = getPendingReqs();
  const current = new Set();
  for (const [id, type] of rels) {
    if (type !== REL_PENDING_INCOMING) continue;
    current.add(id);
    if (!pending[id]) {
      const since = Date.parse(safe(() => RelationshipStore?.getSince?.(id)) || "") || Date.now();
      pending[id] = { ...snapshotUser(id), at: since };
    }
  }
  // pedidos que sumiram enquanto o plugin estava desligado (sem aceitar)
  const canceled = getCanceledReqs();
  let changed = false;
  for (const id of Object.keys(pending)) {
    if (current.has(id)) continue;
    if (typeOf.get(id) !== REL_FRIEND && pending[id]?.userId && pending[id]?.at) {
      canceled.unshift({ ...pending[id], canceledAt: null, offline: true });
      changed = true;
    }
    delete pending[id];
  }
  savePendingReqs(pending);
  if (changed) saveCanceledReqs(canceled);
}
function onRelationshipAdd(action) {
  try {
    if (!getSettings().friendReqTrack) return;
    const rel = action?.relationship;
    if (!rel?.id) return;
    const pending = getPendingReqs();
    if (rel.type === REL_PENDING_INCOMING) {
      pending[rel.id] = { ...snapshotUser(rel.id, rel.user), at: Date.parse(rel.since || "") || Date.now() };
      savePendingReqs(pending);
    } else if (pending[rel.id]) {
      delete pending[rel.id]; // aceito ou bloqueado
      savePendingReqs(pending);
    }
  } catch (e) { Logger.error("RELATIONSHIP_ADD", e); }
}
function onRelationshipRemove(action) {
  try {
    if (!getSettings().friendReqTrack) return;
    const id = action?.relationship?.id;
    if (!id) return;
    const pending = getPendingReqs();
    const req = pending[id];
    if (!req) return;
    delete pending[id];
    savePendingReqs(pending);
    const mine = declinedByMe.get(id);
    if (mine && Date.now() - mine < 30000) return; // foi você que recusou
    const entry = { ...req, ...snapshotUser(id), at: req.at, canceledAt: Date.now() };
    saveCanceledReqs([entry, ...getCanceledReqs()]);
    const s = getSettings();
    notify({
      title: L("Pedido de amizade cancelado", "Friend request canceled"),
      text: L(`${nameOf(id, req)} te mandou pedido de amizade e cancelou${req.at ? ` depois de ${fmtDur(Date.now() - req.at)}` : ""}`, `${nameOf(id, req)} sent you a friend request and canceled it${req.at ? ` after ${fmtDur(Date.now() - req.at)}` : ""}`),
      icon: entry.avatarURL, toast: s.friendReqToast, desktop: s.friendReqDesktop, sound: s.friendReqSound,
    });
  } catch (e) { Logger.error("RELATIONSHIP_REMOVE", e); }
}
function patchRelationshipActions() {
  if (!RelationshipActions) return;
  for (const key of Object.keys(RelationshipActions)) {
    if (typeof RelationshipActions[key] !== "function" || !/remove|cancel|ignore|decline|block/i.test(key)) continue;
    Patcher.before(RelationshipActions, key, (_, args) => {
      const a = args?.[0];
      const id = typeof a === "string" ? a : a?.userId || a?.id;
      if (id) declinedByMe.set(String(id), Date.now());
    });
  }
}

/* ================================================================== */
/* Tempo em call com cada pessoa (as SUAS calls)                        */
/* ================================================================== */
const CALL_FILE = "LurkCalls";
const callData = { owner: null, sessions: [], timer: null, dirty: false };
const callBus = createBus();
function loadCalls() {
  if (callData.owner === myId()) return callData;
  flushCalls();
  callData.owner = myId();
  callData.sessions = safe(() => RawData.load(CALL_FILE, `sessions_${myId()}`)) || [];
  return callData;
}
function flushCalls() {
  if (!callData.dirty || !callData.owner) return;
  clearTimeout(callData.timer);
  try { RawData.save(CALL_FILE, `sessions_${callData.owner}`, callData.sessions); } catch (e) { Logger.error("calls save", e); }
  callData.dirty = false;
}
function saveCallsSoon() {
  callData.dirty = true;
  clearTimeout(callData.timer);
  callData.timer = setTimeout(flushCalls, 1500);
  callBus.emit();
}
const myCall = { sess: null };
function startMyCall(vs, already) {
  const now = Date.now();
  const present = usersInChannel(vs.channelId).filter((id) => id && id !== myId());
  myCall.sess = { ...placeOf(vs.guildId, vs.channelId), joinedAt: now, already: !!already, peers: Object.fromEntries(present.map((id) => [id, { since: now, ms: 0 }])) };
  callBus.emit();
}
function peerEnter(id) {
  const p = myCall.sess?.peers[id];
  if (!myCall.sess) return;
  if (!p) myCall.sess.peers[id] = { since: Date.now(), ms: 0 };
  else if (p.since == null) p.since = Date.now();
}
function peerLeave(id) {
  const p = myCall.sess?.peers[id];
  if (p && p.since != null) { p.ms += Date.now() - p.since; p.since = null; }
}
function endMyCall(cut) {
  const s = myCall.sess;
  if (!s) return;
  for (const id of Object.keys(s.peers)) peerLeave(id);
  myCall.sess = null;
  const peers = Object.entries(s.peers).filter(([, p]) => p.ms >= 1000).map(([id, p]) => {
    const u = UserStore?.getUser?.(id);
    return { id, ms: p.ms, name: nameOf(id), username: u?.username || null, avatarURL: avatarOf(u, id) };
  });
  const d = loadCalls();
  d.sessions = [{ ...s, peers, leftAt: Date.now(), cut: !!cut }, ...d.sessions].slice(0, 5000);
  saveCallsSoon();
}
function processMyCall(list) {
  if (!getSettings().trackMyCalls) return;
  const me = myId();
  for (const raw of list) {
    const vs = normVS(raw);
    if (!vs?.userId) continue;
    if (vs.userId === me) {
      if ((myCall.sess?.channelId || null) !== (vs.channelId || null)) {
        if (myCall.sess) endMyCall();
        if (vs.channelId) startMyCall(vs);
      }
    } else if (myCall.sess) {
      if (vs.channelId && vs.channelId === myCall.sess.channelId) peerEnter(vs.userId);
      else peerLeave(vs.userId);
    }
  }
  callBus.emit();
}
function initMyCall() {
  if (!getSettings().trackMyCalls) return;
  const vs = normVS(safe(() => VoiceStateStore?.getVoiceStateForUser?.(myId())));
  if (vs?.channelId) startMyCall(vs, true);
}
// soma por pessoa (inclui a call atual)
function callTotals() {
  const map = new Map();
  const add = (p, at, ms, place) => {
    const t = map.get(p.id) || { id: p.id, name: p.name, username: p.username, avatarURL: p.avatarURL, ms: 0, calls: 0, lastAt: 0, place: null };
    t.ms += ms; t.calls += 1;
    if (at > t.lastAt) { t.lastAt = at; t.place = place; t.name = p.name || t.name; t.avatarURL = p.avatarURL || t.avatarURL; }
    map.set(p.id, t);
  };
  for (const s of loadCalls().sessions) for (const p of s.peers || []) add(p, s.leftAt, p.ms, placeLabel(s));
  if (myCall.sess) {
    for (const [id, p] of Object.entries(myCall.sess.peers)) {
      const ms = p.ms + (p.since != null ? Date.now() - p.since : 0);
      if (ms >= 1000) add({ id, name: nameOf(id), username: usernameOf(id), avatarURL: avatarOf(UserStore?.getUser?.(id), id) }, Date.now(), ms, placeLabel(myCall.sess));
    }
  }
  return [...map.values()].sort((a, b) => b.ms - a.ms);
}

/* ================================================================== */
/* Apagadas e editadas: feed permanente dos VIPs                        */
/* ================================================================== */
// Usa as mensagens que o Lurk já registra dos VIPs (servidores + privado).
const snipeBus = vipBus;
const getDeletedSeen = () => Data.load(k("deletedSeen")) || 0;
function markDeletedSeen() { Data.save(k("deletedSeen"), Date.now()); updateSnipeBadge(); }
const lastChangeAt = (m) => Math.max(m.deletedAt || 0, m.edits?.length ? m.edits[m.edits.length - 1].at : 0);
const vipChanges = () => loadVip().messages.filter((m) => isVip(m.userId) && (m.deletedAt || m.edits?.length)).sort((a, b) => lastChangeAt(b) - lastChangeAt(a));
const newChangesCount = () => { const seen = getDeletedSeen(); return vipChanges().filter((m) => lastChangeAt(m) > seen).length; };
const snipeCountFor = (channelId) => (channelId ? vipChanges().filter((m) => m.channelId === channelId).length : 0);
// Interceptor: roda ANTES dos stores. Se um VIP apaga/edita uma mensagem que já estava
// carregada antes de o Lurk começar a registrar, salva a versão original a tempo.
let snipeActive = false;
function snipeInterceptor(action) {
  try {
    if (!snipeActive || (action.type !== "MESSAGE_DELETE" && action.type !== "MESSAGE_UPDATE")) return false;
    const s = getSettings();
    if (!s.vipRecordMessages) return false;
    const id = action.id || action.message?.id;
    const cid = action.channelId || action.message?.channel_id;
    if (!id || !cid) return false;
    const m = safe(() => MessageStore?.getMessage?.(cid, id));
    const uid = m?.author?.id;
    if (!uid || !isVip(uid) || loadVip().messages.some((x) => x.id === id)) return false;
    const ch = ChannelStore?.getChannel?.(cid);
    const gid = ch?.guild_id || null;
    if (!gid && !s.vipRecordDMs) return false;
    const ts = m.timestamp?.toISOString?.() || (m.timestamp ? String(m.timestamp) : null);
    recordVipMessage({ id, author: { id: uid }, content: m.content || "", attachments: m.attachments || [], sticker_items: m.stickerItems || m.sticker_items || [], timestamp: ts }, cid, gid, ch);
  } catch {}
  return false;
}

/* ================================================================== */
/* Primeiro contato                                                     */
/* ================================================================== */
const knownContacts = new Set();
const firstThrottle = new Map();
const getFirstContacts = () => (Data.load(k("firstContacts")) || []).filter((e) => e.via !== "message");
function saveFirstContacts(list) { Data.save(k("firstContacts"), list.slice(0, 2000)); reqBus.emit(); updateBadge(); }
function initKnownContacts() {
  knownContacts.clear();
  for (const id of Data.load(k("knownContacts")) || []) knownContacts.add(id);
  const ids = safe(() => PrivateChannelSortStore?.getPrivateChannelIds?.()) || Object.keys(safe(() => ChannelStore?.getMutablePrivateChannels?.()) || {});
  for (const cid of ids) {
    const ch = ChannelStore?.getChannel?.(cid);
    if (ch?.type === 1 && ch.lastMessageId) (ch.recipients || []).forEach((r) => knownContacts.add(r));
  }
}
function rememberContact(id) {
  if (!id || knownContacts.has(id)) return;
  knownContacts.add(id);
  const saved = Data.load(k("knownContacts")) || [];
  saved.push(id);
  Data.save(k("knownContacts"), saved.slice(-5000));
}
// Primeiro contato: alguém que nunca falou com você digitou e PAROU sem enviar.
// (Quem manda a mensagem é descartado — evita spam de bots.)
function checkFirstContact(sess) {
  const s = getSettings();
  const { userId, channelId } = sess;
  if (!s.firstContactTrack || !userId || userId === myId() || knownContacts.has(userId)) return;
  if (Date.now() - (firstThrottle.get(userId) || 0) < 30 * 60000) return;
  firstThrottle.set(userId, Date.now());
  let isRequest = false;
  try { isRequest = !!MessageRequestStore?.isMessageRequest?.(channelId); } catch {}
  const ev = { ...snapshotUser(userId), channelId, at: sess.startedAt, stoppedAt: sess.lastTypingAt, attempts: 1, via: "typing", isFriend: isFriendOf(userId), isRequest };
  saveFirstContacts([ev, ...getFirstContacts()]);
  notify({
    title: L("Novo contato", "New contact"),
    text: L(`${nameOf(userId, ev)} digitou pra você pela primeira vez e não enviou${ev.isFriend === false ? " (não é seu amigo)" : ""}`, `${nameOf(userId, ev)} typed to you for the first time and didn't send${ev.isFriend === false ? " (not a friend)" : ""}`),
    icon: ev.avatarURL, onClick: () => openDM(channelId, userId, false),
    toast: s.firstToast, desktop: s.firstDesktop, sound: s.firstSound,
  });
}

/* ================================================================== */
/* Barra de servidores: foto + indicador (injeção via DOM)              */
/* ================================================================== */
const gb = { container: null, root: null, itemClass: "", size: 40, logged: false };

function findHomeItem() {
  const home = document.querySelector('[data-list-item-id="guildsnav___home"]')
    || document.querySelector('[data-list-item-id$="___home"]');
  if (!home) return null;
  const isListItem = (el) => [...(el.classList || [])].some((c) => /^listItem_/.test(c));
  let item = null;
  for (let el = home; el && el !== document.body; el = el.parentElement) {
    if (isListItem(el)) { item = el; break; }
  }
  if (!item) {
    for (let el = home; el?.parentElement && el.parentElement !== document.body; el = el.parentElement) {
      const sibs = [...el.parentElement.children].filter((c) => c !== gb.container);
      if (sibs.length > 1) { item = el; break; }
    }
  }
  return item ? { home, item } : null;
}

function placeGuildBar() {
  if (!getSettings().showGuildBarAvatar) { unmountGuildBar(); return; }
  const found = findHomeItem();
  if (!found) {
    if (!gb.logged) {
      gb.logged = true;
      diag.guildBar = { error: "home button not found", navs: [...document.querySelectorAll("nav")].slice(0, 4).map((n) => outline(n)) };
      saveDiag();
    }
    return;
  }
  const { home, item } = found;
  if (gb.container?.isConnected && item.nextElementSibling === gb.container) return;

  if (!gb.container) {
    if (!ReactDOMClient?.createRoot) { diag.guildBar = { error: "createRoot unavailable" }; saveDiag(); return; }
    gb.container = document.createElement("div");
    gb.container.className = "dmtt-guildbar dmtt-empty-bar";
    gb.root = ReactDOMClient.createRoot(gb.container);
    gb.root.render(h(GuildBarTyping));
  }
  gb.itemClass = [...item.classList].find((c) => /^listItem_/.test(c)) || "";
  const w = Math.round(home.getBoundingClientRect().width);
  gb.size = w >= 24 && w <= 64 ? w : 40;
  gb.container.style.setProperty("--dmtt-size", `${gb.size}px`);
  item.insertAdjacentElement("afterend", gb.container);
  try {
    const gap = parseFloat(getComputedStyle(item.parentElement).rowGap) || 0;
    const mb = parseFloat(getComputedStyle(item).marginBottom) || 0;
    gb.container.style.marginTop = gap >= 4 || mb >= 4 ? "" : "8px";
    gb.container.style.marginBottom = gap >= 4 ? "" : "8px";
  } catch {}
  liveBus.emit();

  if (!gb.logged) {
    gb.logged = true;
    diag.guildBar = { ok: true, size: gb.size, itemClass: gb.itemClass, parent: outline(item.parentElement) };
    saveDiag();
  }
}
function unmountGuildBar() {
  try { gb.root?.unmount(); } catch {}
  gb.container?.remove();
  gb.container = null;
  gb.root = null;
}

function useSelectedChannelId() {
  const [id, setId] = React.useState(() => SelectedChannelStore?.getChannelId?.());
  React.useEffect(() => {
    if (!SelectedChannelStore) return;
    const fn = () => setId(SelectedChannelStore.getChannelId());
    SelectedChannelStore.addChangeListener(fn);
    return () => SelectedChannelStore.removeChangeListener(fn);
  }, []);
  return id;
}

function TypingAvatar({ session, spinnerType }) {
  const ref = React.useRef(null);
  const u = UserStore?.getUser?.(session.userId);
  const ch = ChannelStore?.getChannel?.(session.channelId);
  const [src, setSrc] = React.useState(() => avatarOf(u, session.userId));
  const name = u?.globalName || u?.username || L("Alguém", "Someone");
  const isGroup = ch?.type === 3;
  const text = isGroup ? L(`${name} está digitando em ${channelLabel(ch)}...`, `${name} is typing in ${channelLabel(ch)}...`) : L(`${name} está digitando...`, `${name} is typing...`);
  const type = Spinner?.Type?.[spinnerType] ?? Spinner?.Type?.[DEFAULTS.spinnerType];

  React.useEffect(() => {
    let tip = null;
    try { if (ref.current) tip = UI.createTooltip(ref.current, text, { side: "right" }); } catch {}
    return () => { try { tip?.hide?.(); } catch {} };
  }, []);

  return h("div", { className: `${gb.itemClass} dmtt-li` },
    h("span", { className: "dmtt-pill" }),
    h("div", { ref, className: "dmtt-item", role: "button", "aria-label": text, onClick: () => openDM(session.channelId, session.userId, isGroup) },
      h("img", { className: "dmtt-avatar", src, alt: "", draggable: false, onError: () => setSrc(defaultAvatar(u, session.userId)) }),
      h("div", { className: "dmtt-overlay" }, Spinner ? h(Spinner, { type, animated: true }) : null),
    ),
  );
}

function GuildBarTyping() {
  useBus(liveBus, settingsBus);
  const selected = useSelectedChannelId();
  const s = getSettings();
  const list = [...sessions.values()]
    .filter((x) => x.kind !== "guild") // a barra é só para o privado
    .filter((x) => !(s.hideWhenChannelOpen && x.channelId === selected))
    .sort((a, b) => b.startedAt - a.startedAt);
  if (gb.container) gb.container.classList.toggle("dmtt-empty-bar", !list.length);
  if (!list.length) return null;
  return h(React.Fragment, null, list.map((x) => h(TypingAvatar, { key: x.key, session: x, spinnerType: s.spinnerType })));
}

/* ================================================================== */
/* UI: ícones e peças básicas                                           */
/* ================================================================== */
function Icon({ d, size = 16 }) {
  return h("svg", { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true }, h("path", { fill: "currentColor", d }));
}
function SIcon({ d, size = 16, sw = 2 }) {
  return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: sw, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true }, h("path", { d }));
}
const ICON_CHEVRON = "M9.3 5.3a1 1 0 0 1 1.4 0l6 6a1 1 0 0 1 0 1.4l-6 6a1 1 0 1 1-1.4-1.4l5.29-5.3-5.3-5.3a1 1 0 0 1 0-1.4Z";
const ICON_BACK = "M14.7 5.3a1 1 0 0 1 0 1.4L9.42 12l5.3 5.3a1 1 0 0 1-1.42 1.4l-6-6a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 1.4 0Z";
const ICON_X = "M17.3 18.7a1 1 0 0 0 1.4-1.4L13.42 12l5.3-5.3a1 1 0 0 0-1.42-1.4L12 10.58l-5.3-5.3a1 1 0 0 0-1.4 1.42L10.58 12l-5.3 5.3a1 1 0 1 0 1.42 1.4L12 13.42l5.3 5.3Z";
const ICON_CHECK = "M20.7 6.3a1 1 0 0 1 0 1.4l-10 10a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.4l4.3 4.29 9.3-9.3a1 1 0 0 1 1.4 0Z";
// estrela cheia (reserva)
const ICON_STAR_FILL = "M10.81 2.86c.38-1.15 2-1.15 2.38 0l1.89 5.83h6.12c1.2 0 1.71 1.54.73 2.25l-4.95 3.6 1.9 5.82c.37 1.15-.94 2.1-1.93 1.4L12 18.16l-4.95 3.6c-.98.7-2.3-.25-1.92-1.4l1.89-5.82-4.95-3.6c-.98-.71-.48-2.25.73-2.25h6.12l1.9-5.83Z";
const ICON_KEYBOARD = "M20 5a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zM6 13a1 1 0 0 0-1 1v.01a1 1 0 0 0 2 0V14a1 1 0 0 0-1-1m12 0a1 1 0 0 0-1 1v.01a1 1 0 0 0 2 0V14a1 1 0 0 0-1-1m-7.998 0a1 1 0 0 0-.004 2l4 .01a1 1 0 0 0 .005-2zM6 9a1 1 0 0 0-1 1v.01a1 1 0 0 0 2 0V10a1 1 0 0 0-1-1m4 0a1 1 0 0 0-1 1v.01a1 1 0 0 0 2 0V10a1 1 0 0 0-1-1m4 0a1 1 0 0 0-1 1v.01a1 1 0 0 0 2 0V10a1 1 0 0 0-1-1m4 0a1 1 0 0 0-1 1v.01a1 1 0 0 0 2 0V10a1 1 0 0 0-1-1";
// ícones de traço (estilo SF Symbols)
const SI = {
  keyboard: "M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8",
  at: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1",
  userPlus: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6",
  star: "M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z",
  headset: "M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3",
  trash: "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0",
  speaker: "M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14",
  sidebar: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 3v18",
  moon: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z",
  archive: "M21 8v13H3V8M1 3h22v5H1zM10 12h4",
  ban: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM4.93 4.93l14.14 14.14",
  button: "M4 4h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM12 16v6M9 19h6",
  clock: "M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5M12 7v5l3.5 2",
  ghost: "M12 2.5a7.5 7.5 0 0 0-7.5 7.5v11l2.5-1.8 2.5 1.8 2.5-1.8 2.5 1.8 2.5-1.8 2.5 1.8V10A7.5 7.5 0 0 0 12 2.5zM9.5 10v1.5M14.5 10v1.5",
  ninja: "M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19zM2.8 9.5h18.4v4.6H2.8zM7.5 11.8h3M13.5 11.8h3M21.2 9.5l1.8-1.6M21.2 14.1l1.8 1.6",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35",
  globe: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2c2.5 2.7 4 6.2 4 10s-1.5 7.3-4 10M12 2c-2.5 2.7-4 6.2-4 10s1.5 7.3 4 10",
  refresh: "M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5",
  sparkle: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z",
};
const LURK_ICON = () => SI[getSettings().lurkIcon] || SI.ghost;
function IconTile({ name, color, size = 28 }) {
  return h("span", { className: "dmtt-tile", style: { background: color, width: size, height: size } }, h(SIcon, { d: SI[name] || SI.gear, size: Math.round(size * 0.6), sw: 2.2 }));
}

// Ícones de dispositivo
const DEVICE_ICON = {
  desktop: "M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 21h8M12 17v4",
  mobile: "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2",
  web: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2c2.5 2.7 4 6.2 4 10s-1.5 7.3-4 10M12 2c-2.5 2.7-4 6.2-4 10s1.5 7.3 4 10",
  embedded: "M6 11h4M8 9v4M15 12h.01M18 10h.01M17.3 5H6.7a4 4 0 0 0-4 3.6L2 15a3 3 0 0 0 5.5 1.7L9 15h6l1.5 1.7A3 3 0 0 0 22 15l-.7-6.4A4 4 0 0 0 17.3 5z",
  vr: "M3 8h18a1 1 0 0 1 1 1v6a2 2 0 0 1-2 2h-4l-2-3-2 3H4a2 2 0 0 1-2-2V9a1 1 0 0 1 1-1z",
};
function Devices({ devices, size = 13 }) {
  const list = [...new Set(devices || [])].filter((d) => DEVICE_ICON[d] || DEVICE_PT[d]);
  if (!list.length) return null;
  return h("span", { className: "dmtt-devices" }, list.map((d) => DEVICE_ICON[d]
    ? h("span", { key: d, className: "dmtt-device", title: DEVICE_PT[d] || d }, h(SIcon, { d: DEVICE_ICON[d], size }))
    : h("span", { key: d, className: "dmtt-device" }, DEVICE_PT[d])));
}
function joinNodes(parts) {
  const out = [];
  parts.filter((x) => x !== null && x !== undefined && x !== false && x !== "").forEach((x, i) => {
    if (i) out.push(h("span", { key: `sep${i}`, className: "dmtt-sep" }, " · "));
    out.push(typeof x === "string" || typeof x === "number" ? h(React.Fragment, { key: `p${i}` }, String(x)) : React.cloneElement(x, { key: `p${i}` }));
  });
  return out;
}
const StatusWithDevices = ({ text, devices }) => h("span", { className: "dmtt-inline" }, text, h(Devices, { devices }));

function Avatar({ userId, url, status, size = 40 }) {
  const u = UserStore?.getUser?.(userId);
  const [src, setSrc] = React.useState(url || avatarOf(u, userId));
  const dot = Math.max(10, Math.round(size * 0.3));
  return h("div", { className: "dmtt-av", style: { width: size, height: size } },
    h("img", { src, alt: "", onError: () => setSrc(defaultAvatar(u, userId)) }),
    status && status !== "unknown" ? h("span", { className: `dmtt-dot dmtt-dot-${status}`, style: { width: dot, height: dot }, title: STATUS_PT[status] }) : null);
}
function Segmented({ value, onChange, options }) {
  return h("div", { className: "dmtt-seg", role: "tablist" },
    options.map(([v, label, n]) => h("button", {
      key: v, role: "tab", "aria-selected": value === v,
      className: `dmtt-seg-btn ${value === v ? "is-on" : ""}`, onClick: () => onChange(v),
    }, label, n ? h("span", { className: "dmtt-seg-n" }, n) : null)));
}
function Search({ value, onChange, placeholder }) {
  return h("label", { className: "dmtt-search" },
    h(SIcon, { d: SI.search, size: 14 }),
    h("input", { placeholder: placeholder || L("Buscar", "Search"), value, onChange: (e) => onChange(e.target.value) }),
    value ? h("button", { className: "dmtt-search-x", onClick: () => onChange(""), title: L("Limpar", "Clear") }, h(Icon, { d: ICON_X, size: 10 })) : null);
}
const Empty = ({ icon, title, children }) => h("div", { className: "dmtt-empty" },
  icon ? h("div", { className: "dmtt-empty-ico" }, h(SIcon, { d: SI[icon], size: 28, sw: 1.6 })) : null,
  title ? h("div", { className: "dmtt-empty-title" }, title) : null,
  children ? h("div", null, children) : null);

/* ---------- listas agrupadas (inset grouped) ---------- */
function Group({ header, footer, children, flush }) {
  const kids = React.Children.toArray(children).filter(Boolean);
  if (!kids.length) return null;
  return h("section", { className: "dmtt-sec" },
    header ? h("div", { className: "dmtt-sec-h" }, header) : null,
    h("div", { className: `dmtt-group ${flush ? "is-flush" : ""}` }, kids),
    footer ? h("div", { className: "dmtt-sec-f" }, footer) : null);
}
function NavRow({ icon, color, avatar, title, subtitle, detail, badge, onClick, danger }) {
  return h("button", { className: `dmtt-row ${danger ? "is-danger" : ""}`, onClick },
    icon ? h(IconTile, { name: icon, color }) : avatar || null,
    h("span", { className: "dmtt-row-main" },
      h("span", { className: "dmtt-row-title" }, title),
      subtitle ? h("span", { className: "dmtt-row-sub" }, subtitle) : null),
    detail != null && detail !== "" ? h("span", { className: "dmtt-row-detail" }, detail) : null,
    badge ? h("span", { className: "dmtt-badge-red" }, badge > 99 ? "99+" : badge) : null,
    onClick ? h("span", { className: "dmtt-chev" }, h(Icon, { d: ICON_CHEVRON, size: 14 })) : null);
}
function Switch({ checked, onChange, label }) {
  return h("button", { role: "switch", "aria-checked": !!checked, "aria-label": label, className: `dmtt-switch ${checked ? "is-on" : ""}`, onClick: (e) => { e.stopPropagation(); onChange(!checked); } }, h("span", { className: "dmtt-switch-knob" }));
}
function Stepper({ value, onChange, min = 0, max = 9999, step = 1, unit }) {
  const [draft, setDraft] = React.useState(String(value));
  React.useEffect(() => setDraft(String(value)), [value]);
  const clamp = (n) => Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
  const commit = (n) => { const v = clamp(n); setDraft(String(v)); if (v !== value) onChange(v); };
  return h("span", { className: "dmtt-stepper" },
    h("button", { className: "dmtt-step-btn", onClick: () => commit(Number(value) - step), disabled: value <= min, "aria-label": L("Diminuir", "Decrease") }, "−"),
    h("input", { value: draft, inputMode: "numeric", onChange: (e) => setDraft(e.target.value.replace(/[^0-9]/g, "")), onBlur: () => commit(parseInt(draft, 10)), onKeyDown: (e) => { if (e.key === "Enter") e.target.blur(); } }),
    unit ? h("span", { className: "dmtt-step-unit" }, unit) : null,
    h("button", { className: "dmtt-step-btn", onClick: () => commit(Number(value) + step), disabled: value >= max, "aria-label": L("Aumentar", "Increase") }, "+"));
}
const txt = (v) => (typeof v === "function" ? v() : v);
function SettingRow({ item }) {
  useBus(settingsBus);
  const value = getSettings()[item.id];
  const set = (v) => { setSetting(item.id, v); item.after?.(v); };
  if (item.type === "text") {
    return h("div", { className: "dmtt-row dmtt-row-col" },
      h("span", { className: "dmtt-row-title" }, txt(item.label)),
      h("input", { className: "dmtt-text", defaultValue: value || "", placeholder: txt(item.placeholder) || "", onBlur: (e) => set(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") e.target.blur(); } }),
      item.note ? h("span", { className: "dmtt-row-sub" }, txt(item.note)) : null);
  }
  const control = item.type === "number" ? h(Stepper, { value: Number(value) || 0, onChange: set, min: item.min, max: item.max, step: item.step, unit: item.unit })
    : item.type === "select" ? h("select", { className: "dmtt-select", value, onChange: (e) => set(e.target.value) }, (typeof item.options === "function" ? item.options() : item.options).map(([v, l]) => h("option", { key: v, value: v }, txt(l))))
    : h(Switch, { checked: !!value, onChange: set, label: txt(item.label) });
  return h("div", { className: "dmtt-row", onClick: item.type === "switch" || !item.type ? () => set(!value) : undefined, style: { cursor: item.type === "switch" || !item.type ? "pointer" : "default" } },
    h("span", { className: "dmtt-row-main" },
      h("span", { className: "dmtt-row-title" }, txt(item.label)),
      item.note ? h("span", { className: "dmtt-row-sub" }, txt(item.note)) : null),
    control);
}
function Hero({ userId, url, status, name, username, chips, children }) {
  return h("div", { className: "dmtt-hero" },
    h(Avatar, { userId, url, status, size: 72 }),
    h("div", { className: "dmtt-hero-name" }, name),
    username ? h("div", { className: "dmtt-hero-user" }, `@${username}`) : null,
    chips?.length ? h("div", { className: "dmtt-chips" }, chips.map((c, i) => h("span", { key: i, className: "dmtt-chip" }, c))) : null,
    children ? h("div", { className: "dmtt-actions" }, children) : null);
}
function ActionButton({ icon, label, onClick, tone }) {
  return h("button", { className: `dmtt-action ${tone ? `is-${tone}` : ""}`, onClick },
    h("span", { className: "dmtt-action-ico" }, icon),
    h("span", null, label));
}
function Stats({ items }) {
  return h("div", { className: "dmtt-stats", style: { gridTemplateColumns: `repeat(${items.length}, 1fr)` } },
    items.map(([v, l]) => h("div", { key: l, className: "dmtt-stat" }, h("b", null, v), h("span", null, l))));
}
function DayList({ items, getTime, render }) {
  return groupByDay(items, getTime).map((d) => h(Group, { key: d.label, header: d.label }, d.items.map(render)));
}
const confirmDanger = (title, text, onConfirm, confirmText) =>
  UI.showConfirmationModal(title, text, { danger: true, confirmText: confirmText || L("Apagar", "Delete"), cancelText: L("Cancelar", "Cancel"), onConfirm });

/* ================================================================== */
/* UI: navegação em pilha (estilo iOS)                                  */
/* ================================================================== */
const NavCtx = React.createContext(null);
const useNav = () => React.useContext(NavCtx);
// nomes das seções (PT / EN) — um lugar só para manter consistente
const NAMES = {
  home: () => L("Hoje", "Today"),
  typing: () => L("Digitou e apagou", "Typed & quit"),
  mentions: () => L("Menções", "Mentions"),
  contacts: () => L("Novos contatos", "New contacts"),
  snipe: () => L("Histórico VIP", "VIP history"),
  vip: () => L("Lista VIP", "VIP list"),
  calls: () => L("Tempo em call", "Call time"),
  settings: () => L("Ajustes", "Settings"),
};
function screenTitle(s) {
  switch (s.type) {
    case "person": return nameOf(s.userId, getHistory().find((r) => r.userId === s.userId) || {});
    case "vipPerson": return nameOf(s.userId, getVipList()[s.userId] || {});
    case "callPerson": return nameOf(s.userId);
    case "settingsPage": return txt(settingsPages().find((p) => p.id === s.id)?.title) || NAMES.settings();
    default: return NAMES[s.type]?.() || "";
  }
}
function App({ initial }) {
  useBus(settingsBus); // troca de idioma re-renderiza tudo
  const [stack, setStack] = React.useState(() => (initial?.length ? initial : [{ type: "home" }]));
  const bodyRef = React.useRef(null);
  const appRef = React.useRef(null);
  // O modal do Discord/BD tem a própria rolagem; desliga a dele e ajusta a altura do app
  // para caber, deixando só a rolagem interna (e o cabeçalho fixo).
  React.useLayoutEffect(() => {
    const el = appRef.current;
    if (!el) return;
    let p = el.parentElement;
    while (p && p !== document.body) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === "auto" || oy === "scroll") && p.scrollHeight >= p.clientHeight) break;
      p = p.parentElement;
    }
    if (!p || p === document.body) return;
    const prevOverflow = p.style.overflowY;
    p.style.overflowY = "hidden";
    p.scrollTop = 0;
    const fit = () => {
      const cs = getComputedStyle(p);
      const box = p.getBoundingClientRect();
      const top = el.getBoundingClientRect().top - box.top;
      const maxH = parseFloat(cs.maxHeight);
      const outer = Number.isFinite(maxH) ? Math.min(maxH, window.innerHeight * 0.8) : p.clientHeight;
      const avail = outer - top - (parseFloat(cs.paddingBottom) || 0) - 2;
      el.style.height = `${Math.max(320, Math.min(680, Math.floor(avail)))}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => { window.removeEventListener("resize", fit); p.style.overflowY = prevOverflow; };
  }, []);
  const nav = React.useMemo(() => ({
    push: (s) => { setStack((st) => [...st, s]); },
    pop: () => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st)),
    popToRoot: () => setStack((st) => st.slice(0, 1)),
  }), []);
  React.useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [stack.length]);
  const top = stack[stack.length - 1];
  const prev = stack[stack.length - 2];
  return h(NavCtx.Provider, { value: { ...nav, stack } },
    h("div", { className: "dmtt-app", ref: appRef },
      h("div", { className: "dmtt-navbar" },
        prev ? h("button", { className: "dmtt-back", onClick: nav.pop }, h(Icon, { d: ICON_BACK, size: 18 }), h("span", null, screenTitle(prev))) : h("span", { className: "dmtt-brand" }, h(SIcon, { d: LURK_ICON(), size: 15 }), "Lurk"),
        h("span", { className: "dmtt-navbar-spacer" }),
        top.type !== "settings" && top.type !== "settingsPage" ? h("button", { className: "dmtt-nav-icon", title: NAMES.settings(), onClick: () => nav.push({ type: "settings" }) }, h(SIcon, { d: SI.gear, size: 17 })) : null),
      h("div", { className: "dmtt-body", ref: bodyRef, key: stack.length }, h(ScreenRouter, { s: top }))));
}
function LargeTitle({ title, subtitle, right }) {
  return h("div", { className: "dmtt-largetitle" },
    h("div", null, h("h1", null, title), subtitle ? h("div", { className: "dmtt-largetitle-sub" }, subtitle) : null),
    right || null);
}
function ScreenRouter({ s }) {
  switch (s.type) {
    case "home": return h(HomeScreen);
    case "typing": return h(TypingScreen, { channelId: s.channelId });
    case "person": return h(PersonScreen, { userId: s.userId, channelId: s.channelId });
    case "mentions": return h(MentionsScreen, { initial: s.seg });
    case "contacts": return h(ContactsScreen, { initial: s.seg });
    case "snipe": return h(SnipeScreen, { channelId: s.channelId, tab: s.tab });
    case "vip": return h(VipScreen);
    case "vipPerson": return h(VipPersonScreen, { userId: s.userId });
    case "calls": return h(CallsScreen);
    case "callPerson": return h(CallPersonScreen, { userId: s.userId });
    case "settings": return h(SettingsScreen);
    case "settingsPage": return h(SettingsPageScreen, { id: s.id });
    default: return null;
  }
}

/* ================================================================== */
/* Tela: Hoje                                                           */
/* ================================================================== */
let lastSeenBeforeOpen = 0;
function counts() {
  const seen = lastSeenBeforeOpen;
  const today = startOfDay(Date.now());
  const hist = getHistory();
  const ments = loadMentions().events;
  const vips = Object.keys(getVipList());
  return {
    quitToday: new Set(hist.filter((r) => r.lastTypingAt >= today).map((r) => r.userId)).size,
    typingPeople: new Set(hist.map((r) => r.userId)).size,
    typingNew: new Set(hist.filter((r) => r.lastTypingAt > seen).map((r) => r.userId)).size,
    ghostsToday: ments.filter((e) => e.at >= today && (e.type === "ghost" || e.type === "reply")).length,
    mentions: ments.length,
    mentionsNew: ments.filter((e) => e.at > seen).length,
    vips: vips.length,
    vipOnline: vips.filter((id) => { const st = rawPresence(id)?.status; return st && st !== "offline"; }).length,
    vipInCall: vips.filter((id) => vipVoice.has(id)).length,
    vipDeletedToday: loadVip().messages.filter((m) => m.deletedAt && m.deletedAt >= today).length,
    contacts: getFirstContacts().length + getCanceledReqs().length,
    contactsNew: getFirstContacts().filter((e) => e.at > seen).length + getCanceledReqs().filter((r) => (r.canceledAt || 0) > seen).length,
    changes: vipChanges().length,
    changesNew: newChangesCount(),
  };
}
function HomeScreen() {
  useBus(historyBus, vipBus, mentionBus, reqBus, callBus, snipeBus);
  useTicker(60000);
  const nav = useNav();
  const c = counts();
  const top = callTotals()[0];
  const tiles = [
    [c.quitToday, L(plural(c.quitToday, "digitou e apagou", "digitaram e apagaram"), plural(c.quitToday, "typed & quit", "typed & quit")), "#0a84ff", { type: "typing" }],
    [c.ghostsToday, plural(c.ghostsToday, "ghost ping", "ghost pings"), "#ff9f0a", { type: "mentions" }],
    c.vips ? [`${c.vipOnline}/${c.vips}`, c.vipInCall ? L(`VIP online · ${c.vipInCall} em call`, `VIPs online · ${c.vipInCall} in a call`) : L("VIP online", "VIPs online"), "#ffd60a", { type: "vip" }]
      : [c.contacts, L(plural(c.contacts, "novo contato", "novos contatos"), plural(c.contacts, "new contact", "new contacts")), "#30d158", { type: "contacts" }],
    c.vips ? [c.vipDeletedToday, L(plural(c.vipDeletedToday, "mensagem VIP apagada", "mensagens VIP apagadas"), plural(c.vipDeletedToday, "VIP message deleted", "VIP messages deleted")), "#ff453a", { type: "vip" }]
      : [c.mentions, L(plural(c.mentions, "menção registrada", "menções registradas"), plural(c.mentions, "mention logged", "mentions logged")), "#ff453a", { type: "mentions" }],
  ];
  return h(React.Fragment, null,
    h(LargeTitle, { title: NAMES.home(), subtitle: new Date().toLocaleDateString(dateLocale(), { weekday: "long", day: "numeric", month: "long" }) }),
    h("div", { className: "dmtt-tiles" }, tiles.map(([v, l, color, to]) => h("button", { key: l, className: "dmtt-tile-card", onClick: () => nav.push(to) },
      h("span", { className: "dmtt-tile-dot", style: { background: color } }),
      h("b", null, v), h("span", null, l)))),
    h(Group, { header: L("Atividade", "Activity") },
      h(NavRow, { icon: "keyboard", color: "#0a84ff", title: NAMES.typing(), subtitle: L("Quem digitou pra você e não enviou", "Who typed to you and didn't send"), detail: c.typingPeople || null, badge: c.typingNew, onClick: () => nav.push({ type: "typing" }) }),
      h(NavRow, { icon: "at", color: "#ff9f0a", title: NAMES.mentions(), subtitle: L("Ghost pings, respostas apagadas, palavras-chave e reações", "Ghost pings, deleted replies, keywords and reactions"), detail: c.mentions || null, badge: c.mentionsNew, onClick: () => nav.push({ type: "mentions" }) }),
      h(NavRow, { icon: "userPlus", color: "#30d158", title: NAMES.contacts(), subtitle: L("Quem digitou pela primeira vez e pedidos cancelados", "First-time typers and canceled friend requests"), detail: c.contacts || null, badge: c.contactsNew, onClick: () => nav.push({ type: "contacts" }) }),
      h(NavRow, { icon: "clock", color: "#ff453a", title: NAMES.snipe(), subtitle: L("Mensagens apagadas e editadas, status e tempo online dos VIPs", "VIPs' deleted & edited messages, status and time online"), detail: c.changes || null, badge: c.changesNew, onClick: () => nav.push({ type: "snipe", channelId: SelectedChannelStore?.getChannelId?.() || null }) })),
    h(Group, { header: L("Pessoas", "People") },
      h(NavRow, { icon: "star", color: "#ffcc00", title: NAMES.vip(), subtitle: c.vips ? L(`${c.vipOnline} de ${c.vips} online${c.vipInCall ? ` · ${c.vipInCall} em call` : ""}`, `${c.vipOnline} of ${c.vips} online${c.vipInCall ? ` · ${c.vipInCall} in a call` : ""}`) : L("Acompanhe pessoas específicas", "Keep an eye on specific people"), onClick: () => nav.push({ type: "vip" }) }),
      h(NavRow, { icon: "headset", color: "#bf5af2", title: NAMES.calls(), subtitle: myCall.sess ? L(`Em call agora · ${placeLabel(myCall.sess)}`, `In a call now · ${placeLabel(myCall.sess)}`) : top ? L(`Mais tempo com ${top.name} (${fmtDur(top.ms)})`, `Most time with ${top.name} (${fmtDur(top.ms)})`) : L("Com quem você mais fica em call", "Who you spend the most time with in calls"), onClick: () => nav.push({ type: "calls" }) })),
    h(Group, null,
      h(NavRow, { icon: "gear", color: "#8e8e93", title: NAMES.settings(), onClick: () => nav.push({ type: "settings" }) })),
    h("div", { className: "dmtt-version" }, `Lurk ${VERSION}`));
}

/* ================================================================== */
/* Tela: Digitou e apagou                                               */
/* ================================================================== */
const attemptsText = (n) => L(`${n} ${plural(n, "tentativa", "tentativas")}`, `${n} ${plural(n, "attempt", "attempts")}`);
function PersonRow({ rows, onOpen }) {
  const latest = rows[0];
  const uname = usernameOf(latest.userId, latest);
  const tries = attemptsOf(latest).length;
  const sub = joinNodes([
    L(`Digitou ${fmtRangeShort(recordRange(latest))}`, `Typed ${fmtRangeShort(recordRange(latest))}`),
    tries > 1 ? attemptsText(tries) : null,
    latest.status === "sent_later" ? L("enviou depois", "sent later") : null,
    latest.isFriend === false ? L("não é amigo", "not a friend") : null,
    whereOf(latest),
    isVip(latest.userId) ? "VIP" : null,
  ]);
  return h("button", { className: "dmtt-row", onClick: onOpen },
    h(Avatar, { userId: latest.userId, url: latest.avatarURL, status: effectiveStatus(lastPresence(latest), latest.isFriend) }),
    h("span", { className: "dmtt-row-main" },
      h("span", { className: "dmtt-row-title" }, displayName(latest), uname ? h("span", { className: "dmtt-row-user" }, ` @${uname}`) : null),
      h("span", { className: "dmtt-row-sub" }, sub)),
    h("span", { className: "dmtt-row-side" },
      h("span", { className: "dmtt-row-time", title: fmtDate(latest.lastTypingAt) }, relTime(latest.lastTypingAt)),
      rows.length > 1 ? h("span", { className: "dmtt-countpill", title: L(`${rows.length} vezes`, `${rows.length} times`) }, `${rows.length}×`) : null),
    h("span", { className: "dmtt-chev" }, h(Icon, { d: ICON_CHEVRON, size: 14 })));
}
function SessionRow({ r, showWhere }) {
  const [open, setOpen] = React.useState(false);
  const at = attemptsOf(r);
  const status = effectiveStatus(at[0]?.presence, r.isFriend);
  const statusEnd = effectiveStatus(at[at.length - 1]?.presenceEnd, r.isFriend);
  const statusText = status ? (statusEnd && statusEnd !== status ? `${STATUS_PT[status]} → ${STATUS_PT[statusEnd]}` : STATUS_PT[status]) : null;
  const devices = [...new Set(at.flatMap((a) => [...(a.presence?.devices || []), ...(a.presenceEnd?.devices || [])]))];
  const multi = at.length > 1;
  return h("div", { className: `dmtt-cell ${open ? "is-open" : ""}` },
    h("div", { className: "dmtt-row", onClick: multi ? () => setOpen(!open) : undefined, style: { cursor: multi ? "pointer" : "default" } },
      h("span", { className: `dmtt-tl-dot ${status ? `dmtt-dot-${status}` : ""}` }),
      h("span", { className: "dmtt-row-main" },
        h("span", { className: "dmtt-row-title dmtt-num" }, multi || r.lastTypingAt - r.startedAt >= 1000 ? `${fmtTime(r.startedAt)} – ${fmtTime(r.lastTypingAt)}` : fmtTime(r.startedAt)),
        h("span", { className: "dmtt-row-sub" }, joinNodes([
          fmtRangeShort(recordRange(r)),
          multi ? attemptsText(at.length) : null,
          statusText ? h(StatusWithDevices, { text: statusText, devices }) : null,
          showWhere ? whereOf(r) : null]))),
      r.status === "sent_later" ? h("span", { className: "dmtt-ok", title: L(`Enviou às ${fmtTime(r.sentLaterAt)}`, `Sent at ${fmtTime(r.sentLaterAt)}`) }, h(Icon, { d: ICON_CHECK, size: 12 }), ` ${fmtHM(r.sentLaterAt)}`) : null,
      h("button", { className: "dmtt-del", title: L("Excluir", "Delete"), onClick: (e) => { e.stopPropagation(); deleteRecords((x) => x.id === r.id); } }, h(Icon, { d: ICON_X, size: 12 })),
      multi ? h("span", { className: "dmtt-chev dmtt-chev-rot" }, h(Icon, { d: ICON_CHEVRON, size: 14 })) : null),
    open ? h("div", { className: "dmtt-sub" }, at.map((a, i) => {
      const st = effectiveStatus(a.presence, r.isFriend);
      return h("div", { key: i, className: "dmtt-subrow" },
        h("span", { className: "dmtt-subrow-n" }, L(`${i + 1}ª`, `#${i + 1}`)),
        h("span", { className: "dmtt-num" }, fmtTime(a.startedAt)),
        h("span", { className: "dmtt-muted" }, fmtRangeShort(attemptRange(a))),
        st ? h("span", { className: "dmtt-muted" }, h(StatusWithDevices, { text: STATUS_PT[st], devices: a.presence?.devices })) : null);
    })) : null);
}
function TypingScreen({ channelId }) {
  useBus(historyBus, vipBus);
  const nav = useNav();
  const [q, setQ] = React.useState("");
  const [seg, setSeg] = React.useState("all");
  const [limit, setLimit] = React.useState(40);
  const base = getHistory().filter((r) => !channelId || r.channelId === channelId);
  const tests = {
    all: () => true, nonfriends: (r) => r.isFriend === false, invisible: recordInvisible,
    groups: (r) => r.channelType === "group", guilds: (r) => r.channelType === "guild", sent: (r) => r.status === "sent_later",
  };
  const countPeople = (fn) => new Set(base.filter(fn).map((r) => r.userId)).size;
  let rows = base.filter(tests[seg]);
  if (q.trim()) { const s = q.trim().toLowerCase(); rows = rows.filter((r) => [displayName(r), r.username, r.globalName, r.groupName, r.guildName, r.channelName, r.userId].some((v) => v && String(v).toLowerCase().includes(s))); }
  rows = rows.slice().sort((a, b) => b.lastTypingAt - a.lastTypingAt);
  const people = [];
  const map = new Map();
  for (const r of rows) { if (!map.has(r.userId)) { const g = []; map.set(r.userId, g); people.push(g); } map.get(r.userId).push(r); }
  const segs = [["all", L("Todos", "All")], ["nonfriends", L("Não amigos", "Not friends")], ["invisible", L("Invisíveis", "Invisible")]];
  if (base.some(tests.groups)) segs.push(["groups", L("Grupos", "Groups")]);
  if (base.some(tests.guilds)) segs.push(["guilds", L("Servidores", "Servers")]);
  segs.push(["sent", L("Enviaram depois", "Sent later")]);
  const stamp = new Date().toISOString().slice(0, 10);
  return h(React.Fragment, null,
    h(LargeTitle, { title: channelId ? L("Digitou e apagou no grupo", "Typed & quit in group") : NAMES.typing(), subtitle: L(`${people.length} ${plural(people.length, "pessoa", "pessoas")} · mais recentes primeiro`, `${people.length} ${plural(people.length, "person", "people")} · most recent first`) }),
    h(Search, { value: q, onChange: setQ, placeholder: L("Buscar por nome, @ ou servidor", "Search by name, @ or server") }),
    h(Segmented, { value: seg, onChange: (v) => { setSeg(v); setLimit(40); }, options: segs.map(([v, l]) => [v, l, v === "all" ? null : countPeople(tests[v])]) }),
    people.length
      ? h(Group, null, people.slice(0, limit).map((g) => h(PersonRow, { key: g[0].userId, rows: g, onOpen: () => nav.push({ type: "person", userId: g[0].userId, channelId }) })))
      : h(Empty, { icon: "keyboard", title: base.length ? L("Nada com esse filtro", "Nothing matches this filter") : L("Ninguém desistiu ainda", "No one has quit yet") }, base.length ? null : L("Quando alguém digitar pra você e não enviar, aparece aqui.", "When someone types to you and doesn't send, it shows up here.")),
    people.length > limit ? h("button", { className: "dmtt-more", onClick: () => setLimit(limit + 40) }, L("Mostrar mais", "Show more")) : null,
    base.length ? h(Group, null,
      h(NavRow, { title: L("Exportar CSV", "Export CSV"), onClick: () => saveFile(`lurk-typed-${stamp}.csv`, typingCsv(rows), "text/csv") }),
      h(NavRow, { title: L("Exportar JSON", "Export JSON"), onClick: () => saveFile(`lurk-typed-${stamp}.json`, JSON.stringify(rows, null, 2), "application/json") }),
      h(NavRow, { title: channelId ? L("Apagar registros deste grupo", "Delete this group's records") : L("Apagar todo o histórico", "Delete all history"), danger: true, onClick: () => confirmDanger(L("Apagar histórico", "Delete history"), L("Essa ação não pode ser desfeita.", "This can't be undone."), () => deleteRecords((r) => !channelId || r.channelId === channelId)) })) : null);
}
function PersonScreen({ userId, channelId }) {
  useBus(historyBus, vipBus);
  const nav = useNav();
  const rows = getHistory().filter((r) => r.userId === userId && (!channelId || r.channelId === channelId)).sort((a, b) => b.lastTypingAt - a.lastTypingAt);
  if (!rows.length) return h(Empty, { icon: "keyboard", title: L("Sem registros", "No records") }, L("Nenhum registro dessa pessoa.", "No records for this person."));
  const latest = rows[0];
  const tries = rows.reduce((n, r) => n + attemptsOf(r).length, 0);
  const [lo, hi] = rows.reduce(([a, b], r) => { const [x, y] = recordRange(r); return [a + x, b + y]; }, [0, 0]);
  const vip = isVip(userId);
  const ignored = isIgnoredUser(userId);
  const chips = [
    latest.isFriend === false ? L("Não é amigo", "Not a friend") : latest.isFriend ? L("Amigo", "Friend") : null,
    latest.channelType === "unknown" ? KIND_LABEL.unknown : null,
    latest.isMessageRequest ? L("Solicitação de mensagem", "Message request") : null,
    rows.some(recordInvisible) ? L("Já digitou invisível", "Has typed while invisible") : null,
  ].filter(Boolean);
  const dmRow = rows.find((r) => r.channelType !== "guild");
  return h(React.Fragment, null,
    h(Hero, { userId, url: latest.avatarURL, status: effectiveStatus(lastPresence(latest), latest.isFriend), name: displayName(latest), username: usernameOf(userId, latest), chips },
      dmRow ? h(ActionButton, { icon: h(SIcon, { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z", size: 18 }), label: L("Mensagem", "Message"), onClick: () => openDM(dmRow.channelId, userId, dmRow.channelType === "group") }) : null,
      h(ActionButton, { icon: h(SIcon, { d: SI.star, size: 18 }), label: vip ? L("É VIP", "VIP") : L("Tornar VIP", "Add VIP"), tone: vip ? "vip" : null, onClick: () => toggleVip(userId, displayName(latest)) }),
      vip ? h(ActionButton, { icon: h(SIcon, { d: SI.sparkle, size: 18 }), label: L("Ver VIP", "View VIP"), onClick: () => nav.push({ type: "vipPerson", userId }) }) : null,
      h(ActionButton, { icon: h(SIcon, { d: SI.ban, size: 18 }), label: ignored ? L("Ignorado", "Ignored") : L("Ignorar", "Ignore"), tone: ignored ? "muted" : null, onClick: () => toggleIgnore("users", userId, usernameOf(userId, latest) || displayName(latest)) })),
    h(Stats, { items: [[rows.length, L(plural(rows.length, "vez", "vezes"), plural(rows.length, "time", "times"))], [tries, L(plural(tries, "tentativa", "tentativas"), plural(tries, "attempt", "attempts"))], [lo < 1000 ? `≤${fmtSecs(hi)}` : `~${fmtSecs(lo)}`, L("digitando", "typing")]] }),
    h(DayList, { items: rows, getTime: (r) => r.lastTypingAt, render: (r) => h(SessionRow, { key: r.id, r, showWhere: !channelId }) }),
    h(Group, null, h(NavRow, { title: L("Apagar histórico desta pessoa", "Delete this person's history"), danger: true, onClick: () => confirmDanger(L("Apagar histórico", "Delete history"), L(`Apagar o histórico de ${displayName(latest)}?`, `Delete ${displayName(latest)}'s history?`), () => { deleteRecords((x) => x.userId === userId && (!channelId || x.channelId === channelId)); nav.pop(); }) })));
}

/* ================================================================== */
/* Tela: Menções                                                        */
/* ================================================================== */
function EmojiView({ e }) {
  if (!e) return null;
  if (e.id) return h("img", { className: "dmtt-emoji", src: `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? "gif" : "webp"}?size=32`, alt: e.name || "", title: `:${e.name}:` });
  return h("span", { className: "dmtt-emoji-txt" }, e.name);
}
const MENTION_LABEL = labelMap(
  { ghost: "Ghost pings", reply: "Respostas apagadas", keyword: "Palavras-chave", reaction: "Reações removidas" },
  { ghost: "Ghost pings", reply: "Deleted replies", keyword: "Keywords", reaction: "Removed reactions" });
const NO_TEXT = () => L("[sem texto]", "[no text]");
function MessageCard({ avatar, name, action, meta, time, body, bodyTone, extra, onJump, onDelete }) {
  const [open, setOpen] = React.useState(false);
  const long = typeof body === "string" && body.length > 160;
  return h("div", { className: "dmtt-card" },
    h("div", { className: "dmtt-card-head" },
      avatar,
      h("span", { className: "dmtt-row-main" },
        h("span", { className: "dmtt-row-title" }, name, action ? h("span", { className: "dmtt-card-action" }, " ", action) : null),
        meta ? h("span", { className: "dmtt-row-sub" }, meta) : null),
      time ? h("span", { className: "dmtt-row-time" }, time) : null,
      onDelete ? h("button", { className: "dmtt-del", title: L("Excluir", "Delete"), onClick: onDelete }, h(Icon, { d: ICON_X, size: 12 })) : null),
    body ? h("div", { className: `dmtt-bubble ${bodyTone ? `is-${bodyTone}` : ""}`, onClick: long ? () => setOpen(!open) : undefined, style: long ? { cursor: "pointer" } : null }, long && !open ? `${body.slice(0, 160)}…` : body) : null,
    extra || null,
    onJump ? h("button", { className: "dmtt-link", onClick: onJump }, L("Ir para mensagem", "Jump to message")) : null);
}
function MentionsScreen({ initial = "all" }) {
  useBus(mentionBus, settingsBus);
  const nav = useNav();
  const [seg, setSeg] = React.useState(initial);
  const [q, setQ] = React.useState("");
  const [limit, setLimit] = React.useState(40);
  const all = loadMentions().events;
  const count = (t) => all.filter((e) => e.type === t).length;
  let list = seg === "all" ? all : all.filter((e) => e.type === seg);
  if (q.trim()) { const s = q.trim().toLowerCase(); list = list.filter((e) => [nameOf(e.userId, e), e.username, e.content, e.keyword, e.guildName, e.channelName].some((v) => v && String(v).toLowerCase().includes(s))); }
  const render = (e) => {
    const lived = e.deletedAt && e.createdAt ? fmtDur(e.deletedAt - e.createdAt) : null;
    const action = e.type === "ghost" ? (e.edited ? L("te marcou e tirou a menção", "pinged you, then edited it out") : L("te marcou e apagou", "pinged you, then deleted it"))
      : e.type === "reply" ? L("respondeu você e apagou", "replied to you, then deleted it")
      : e.type === "keyword" ? h("span", null, L("falou ", "said "), h("b", { className: "dmtt-kw" }, e.keyword))
      : h("span", { className: "dmtt-inline" }, L("reagiu ", "reacted "), h(EmojiView, { e: e.emoji }), L(" e tirou", " and removed it"));
    const body = e.type === "reaction" ? (e.myContent ? L(`Sua mensagem: ${e.myContent}`, `Your message: ${e.myContent}`) : null) : (e.content || (e.attachments?.length ? `[${e.attachments.join(", ")}]` : null));
    return h(MessageCard, {
      key: e.id, avatar: h(Avatar, { userId: e.userId, url: e.avatarURL, size: 32 }), name: nameOf(e.userId, e), action,
      meta: joinNodes([placeLabel(e), lived ? (e.type === "reaction" ? L(`tirou após ${lived}`, `removed after ${lived}`) : L(`${lived} no ar`, `up for ${lived}`)) : null]),
      time: fmtHM(e.createdAt || e.at), body, bodyTone: e.type === "ghost" || e.type === "reply" ? "deleted" : null,
      extra: h(React.Fragment, null,
        e.type === "reply" && e.replyTo ? h("div", { className: "dmtt-quote" }, h("b", null, L("Em resposta a: ", "In reply to: ")), e.replyTo) : null,
        e.edited && e.newContent != null ? h("div", { className: "dmtt-quote" }, h("b", null, L("Depois da edição: ", "After editing: ")), e.newContent || NO_TEXT()) : null),
      onJump: e.type === "keyword" || e.type === "reaction" ? () => jumpTo(e.guildId, e.channelId, e.messageId) : null,
      onDelete: () => deleteMentionEvents((x) => x.id === e.id),
    });
  };
  const noKw = seg === "keyword" && !keywordList().length;
  return h(React.Fragment, null,
    h(LargeTitle, { title: NAMES.mentions(), subtitle: L("Ghost pings, respostas apagadas, palavras-chave e reações removidas", "Ghost pings, deleted replies, keywords and removed reactions") }),
    all.length > 8 ? h(Search, { value: q, onChange: setQ }) : null,
    h(Segmented, { value: seg, onChange: (v) => { setSeg(v); setLimit(40); }, options: [["all", L("Todas", "All")], ["ghost", "Ghost", count("ghost")], ["reply", L("Respostas", "Replies"), count("reply")], ["keyword", L("Palavras", "Keywords"), count("keyword")], ["reaction", L("Reações", "Reactions"), count("reaction")]] }),
    noKw ? h(Group, { footer: L("Ignora maiúsculas e acentos e só casa a palavra inteira.", "Case- and accent-insensitive, whole words only.") }, h(NavRow, { icon: "at", color: "#ff9f0a", title: L("Configurar palavras-chave", "Set up keywords"), onClick: () => nav.push({ type: "settingsPage", id: "mentions" }) })) : null,
    list.length ? h(DayList, { items: list.slice(0, limit), getTime: (e) => e.at, render }) : (!noKw ? h(Empty, { icon: "at", title: all.length ? L("Nada com esse filtro", "Nothing matches this filter") : L("Tudo limpo", "All clear") }, all.length ? null : L("Ninguém te marcou e apagou ainda.", "No one has pinged you and deleted it yet.")) : null),
    list.length > limit ? h("button", { className: "dmtt-more", onClick: () => setLimit(limit + 40) }, L("Mostrar mais", "Show more")) : null,
    list.length ? h(Group, null, h(NavRow, { title: seg === "all" ? L("Apagar todas as menções", "Delete all mentions") : L(`Apagar "${MENTION_LABEL[seg]}"`, `Delete "${MENTION_LABEL[seg]}"`), danger: true, onClick: () => confirmDanger(L("Apagar", "Delete"), L("Essa ação não pode ser desfeita.", "This can't be undone."), () => deleteMentionEvents((e) => seg === "all" || e.type === seg)) })) : null);
}

/* ================================================================== */
/* Tela: Novos contatos (digitou pela 1ª vez + pedidos cancelados)      */
/* ================================================================== */
function ContactsScreen({ initial = "first" }) {
  useBus(reqBus);
  const [seg, setSeg] = React.useState(initial);
  const first = getFirstContacts();
  const reqs = getCanceledReqs();
  const pendingCount = Object.keys(getPendingReqs()).length;
  const pendingText = L(`${pendingCount} ${plural(pendingCount, "pedido pendente", "pedidos pendentes")} agora.`, `${pendingCount} pending ${plural(pendingCount, "request", "requests")} right now.`);
  const sameReq = (a, b) => a.userId === b.userId && a.canceledAt === b.canceledAt && a.at === b.at;
  return h(React.Fragment, null,
    h(LargeTitle, { title: NAMES.contacts(), subtitle: L("Quem nunca falou com você e digitou sem enviar, e quem cancelou o pedido de amizade", "People who never talked to you and typed without sending, and canceled friend requests") }),
    h(Segmented, { value: seg, onChange: setSeg, options: [["first", L("Digitou pela 1ª vez", "First-time typers"), first.length], ["requests", L("Pedidos cancelados", "Canceled requests"), reqs.length]] }),
    seg === "first"
      ? (first.length ? h(DayList, { items: first, getTime: (e) => e.at, render: (e) => h("div", { key: `${e.userId}-${e.at}`, className: "dmtt-row" },
          h(Avatar, { userId: e.userId, url: e.avatarURL }),
          h("span", { className: "dmtt-row-main" },
            h("span", { className: "dmtt-row-title" }, nameOf(e.userId, e), e.username ? h("span", { className: "dmtt-row-user" }, ` @${e.username}`) : null),
            h("span", { className: "dmtt-row-sub" }, joinNodes([
              e.stoppedAt ? L(`Digitou ${fmtRangeShort(attemptRange({ startedAt: e.at, lastTypingAt: e.stoppedAt, signals: e.stoppedAt > e.at ? 2 : 1 }))} e não enviou`, `Typed ${fmtRangeShort(attemptRange({ startedAt: e.at, lastTypingAt: e.stoppedAt, signals: e.stoppedAt > e.at ? 2 : 1 }))} and didn't send`) : L("Digitou e não enviou", "Typed and didn't send"),
              e.isFriend === false ? L("não é amigo", "not a friend") : null,
              e.isRequest ? L("solicitação de mensagem", "message request") : null]))),
          h("span", { className: "dmtt-row-time" }, fmtHM(e.at)),
          h("button", { className: "dmtt-del", title: L("Excluir", "Delete"), onClick: () => saveFirstContacts(getFirstContacts().filter((x) => !(x.userId === e.userId && x.at === e.at))) }, h(Icon, { d: ICON_X, size: 12 })),
          h("button", { className: "dmtt-link", onClick: () => openDM(e.channelId, e.userId, false) }, L("Abrir", "Open"))) })
        : h(Empty, { icon: "userPlus", title: L("Ninguém novo por aqui", "No one new yet") }, L("Quando alguém que nunca falou com você digitar e parar sem enviar, aparece aqui.", "When someone who never talked to you types and stops without sending, it shows up here.")))
      : (reqs.length ? h(DayList, { items: reqs, getTime: (r) => r.canceledAt || r.at || 0, render: (r, i) => h("div", { key: `${r.userId}-${r.canceledAt}-${i}`, className: "dmtt-row" },
          h(Avatar, { userId: r.userId, url: r.avatarURL }),
          h("span", { className: "dmtt-row-main" },
            h("span", { className: "dmtt-row-title" }, nameOf(r.userId, r), r.username ? h("span", { className: "dmtt-row-user" }, ` @${r.username}`) : null),
            h("span", { className: "dmtt-row-sub" }, r.canceledAt
              ? L(`Pediu às ${fmtHM(r.at)} · cancelou após ${fmtDur(r.canceledAt - r.at)}`, `Sent at ${fmtHM(r.at)} · canceled after ${fmtDur(r.canceledAt - r.at)}`)
              : L(`Pediu em ${fmtDate(r.at).slice(0, 16)} · sumiu com o plugin desligado`, `Sent on ${fmtDate(r.at).slice(0, 16)} · gone while the plugin was off`))),
          h("span", { className: "dmtt-row-time" }, r.canceledAt ? relTime(r.canceledAt) : ""),
          h("button", { className: "dmtt-del", title: L("Excluir", "Delete"), onClick: () => saveCanceledReqs(getCanceledReqs().filter((x) => !sameReq(x, r))) }, h(Icon, { d: ICON_X, size: 12 }))) })
        : h(Empty, { icon: "userPlus", title: L("Nenhum pedido cancelado", "No canceled requests") }, pendingText)),
    (seg === "first" ? first.length : reqs.length) ? h(Group, { footer: seg === "requests" ? `${pendingText} ${L("Suas recusas não entram.", "Requests you declined aren't listed.")}` : null },
      h(NavRow, { title: L("Limpar lista", "Clear list"), danger: true, onClick: () => confirmDanger(L("Limpar lista", "Clear list"), L("Essa ação não pode ser desfeita.", "This can't be undone."), () => (seg === "first" ? saveFirstContacts([]) : saveCanceledReqs([]))) })) : null);
}

/* ================================================================== */
/* Tela: Apagadas e editadas (snipe)                                    */
/* ================================================================== */
// Histórico VIP (botão do relógio): mensagens apagadas/editadas, status e pessoas
function SnipeScreen({ channelId, tab: initialTab }) {
  useBus(vipBus, settingsBus);
  const nav = useNav();
  const [tab, setTab] = React.useState(initialTab || "messages");
  const vips = Object.keys(getVipList());
  if (!vips.length) {
    return h(React.Fragment, null, h(LargeTitle, { title: NAMES.snipe() }),
      h(Empty, { icon: "clock", title: L("Sem VIPs ainda", "No VIPs yet") }, L("Aqui aparece o que as pessoas da sua Lista VIP apagam ou editam, quando ficam online, ausentes ou offline, e quanto tempo ficam ativas.", "This is where you'll see what people on your VIP list delete or edit, when they go online, idle or offline, and how long they stay active.")),
      h(Group, null, h(NavRow, { icon: "star", color: "#ffcc00", title: L("Abrir Lista VIP", "Open VIP list"), onClick: () => nav.push({ type: "vip" }) })));
  }
  const nChanges = newChangesCount();
  return h(React.Fragment, null,
    h(LargeTitle, { title: NAMES.snipe(), subtitle: L("Tudo o que seus VIPs fizeram, no privado e nos servidores", "Everything your VIPs did, in DMs and servers") }),
    h(Segmented, { value: tab, onChange: setTab, options: [["messages", L("Mensagens", "Messages"), nChanges || null], ["status", "Status"], ["people", L("Pessoas", "People"), vips.length]] }),
    tab === "messages" ? h(MessagesFeed, { channelId }) : tab === "status" ? h(StatusFeed) : h(VipPeopleList));
}

// tempo online (não-offline) de um VIP desde "from", a partir dos eventos de status
function onlineMs(id, events, from) {
  const pres = events.filter((e) => e.userId === id && e.type === "presence").sort((a, b) => a.at - b.at);
  let total = 0;
  let state = null; let since = from;
  const before = pres.filter((e) => e.at < from);
  if (before.length) state = before[before.length - 1].to;
  // sem nenhuma mudança registrada antes: usa o status atual desde quando entrou na Lista VIP
  if (!state && !pres.some((e) => e.at >= from)) {
    const added = getVipList()[id]?.addedAt || 0;
    const cur = rawPresence(id)?.status;
    if (cur && cur !== "offline" && added) return Date.now() - Math.max(from, added);
    return 0;
  }
  for (const e of pres.filter((x) => x.at >= from)) {
    if (state && state !== "offline") total += e.at - since;
    state = e.to; since = e.at;
  }
  const now = rawPresence(id)?.status || state;
  if (now && now !== "offline" && state && state !== "offline") total += Date.now() - since;
  return total;
}

function StatusFeed() {
  useBus(vipBus);
  useTicker(60000);
  const nav = useNav();
  const list = getVipList();
  const ids = Object.keys(list);
  const [who, setWho] = React.useState("all");
  const [limit, setLimit] = React.useState(60);
  const events = loadVip().events.filter((e) => ids.includes(e.userId) && (e.type === "presence" || e.type === "invisible") && (who === "all" || e.userId === who));
  const byUser = new Map();
  for (const e of loadVip().events) if (e.type === "presence") { (byUser.get(e.userId) || byUser.set(e.userId, []).get(e.userId)).push(e); }
  const durationOf = (e) => {
    if (e.type !== "presence") return null;
    const arr = byUser.get(e.userId) || [];
    const i = arr.indexOf(e);
    const newer = i > 0 ? arr[i - 1] : null;
    return newer ? L(`por ${fmtDur(newer.at - e.at)}`, `for ${fmtDur(newer.at - e.at)}`) : L(`há ${fmtDur(Date.now() - e.at)}`, `${fmtDur(Date.now() - e.at)} ago`);
  };
  const filter = ids.length <= 4
    ? h(Segmented, { value: who, onChange: setWho, options: [["all", L("Todos", "Everyone")], ...ids.map((id) => [id, nameOf(id, list[id])])] })
    : h("div", { className: "dmtt-row2" }, h("select", { className: "dmtt-select dmtt-select-wide", value: who, onChange: (e) => setWho(e.target.value) },
        h("option", { value: "all" }, L("Todos os VIPs", "All VIPs")), ids.map((id) => h("option", { key: id, value: id }, nameOf(id, list[id])))));
  return h(React.Fragment, null,
    filter,
    events.length ? h(DayList, { items: events.slice(0, limit), getTime: (e) => e.at, render: (e, i) => {
      const name = nameOf(e.userId, list[e.userId] || {});
      const text = e.type === "invisible" ? L("visto invisível", "seen while invisible") : (PRESENCE_VERB[e.to] || e.to).replace(/^./, (c) => c.toLowerCase());
      const meta = e.type === "invisible"
        ? (e.via === "typing" ? L(`digitando ${e.where ? `em ${e.where}` : "pra você"}`, `typing ${e.where ? `in ${e.where}` : "to you"}`) : L(`mandou mensagem ${e.where ? `em ${e.where}` : "pra você"}`, `sent a message ${e.where ? `in ${e.where}` : "to you"}`))
        : joinNodes([durationOf(e), e.devices?.length && e.to !== "offline" ? h(Devices, { devices: e.devices }) : null]);
      return h("button", { key: `${e.userId}-${e.at}-${i}`, className: "dmtt-row", onClick: () => nav.push({ type: "vipPerson", userId: e.userId }) },
        h("span", { className: `dmtt-tl-dot ${e.type === "invisible" ? "dmtt-dot-invisible" : `dmtt-dot-${e.to}`}` }),
        h(Avatar, { userId: e.userId, size: 28 }),
        h("span", { className: "dmtt-row-main" },
          h("span", { className: "dmtt-row-title" }, h("span", { className: "dmtt-num dmtt-time-lead" }, fmtHM(e.at)), name, h("span", { className: "dmtt-card-action" }, ` ${text}`)),
          h("span", { className: "dmtt-row-sub" }, meta)),
        h("span", { className: "dmtt-chev" }, h(Icon, { d: ICON_CHEVRON, size: 14 })));
    } }) : h(Empty, { icon: "sparkle", title: L("Sem mudanças de status ainda", "No status changes yet") }, L("Aparecem aqui quando os VIPs ficarem online, ausentes ou offline. Pra quem não é seu amigo, o Discord só manda o status se vocês tiverem um servidor em comum.", "They show up here when VIPs go online, idle or offline. For non-friends, Discord only sends status if you share a server.")),
    events.length > limit ? h("button", { className: "dmtt-more", onClick: () => setLimit(limit + 60) }, L("Mostrar mais", "Show more")) : null);
}

function VipPeopleList() {
  useBus(vipBus);
  useTicker(60000);
  const nav = useNav();
  const list = getVipList();
  const d = loadVip();
  const today = startOfDay(Date.now());
  const ids = Object.keys(list).sort((a, b) => onlineMs(b, d.events, today) - onlineMs(a, d.events, today));
  return h(React.Fragment, null,
    h(Group, { footer: L("O tempo online de hoje aparece à direita quando a pessoa ficou online desde a meia-noite (contado enquanto o Discord e o Lurk estavam abertos). Toque numa pessoa para ver o histórico completo.", "Today's time online shows on the right when the person was online since midnight (counted while Discord and Lurk were open). Tap a person for their full history.") },
      ids.map((id) => {
        const { p, friend, status } = vipStatusNow(id);
        const ms = onlineMs(id, d.events, today);
        const lastOff = d.events.find((e) => e.userId === id && e.type === "presence" && e.to === "offline");
        const lv = vipVoice.get(id);
        const changes = d.messages.filter((m) => m.userId === id && (m.deletedAt || m.edits?.length)).length;
        const now = lv ? h("span", { className: "dmtt-live-inline" }, L("Em call agora", "In a call now"))
          : p && p.status !== "offline" ? h(StatusWithDevices, { text: L(`${STATUS_PT[p.status]} agora`, `${STATUS_PT[p.status]} now`), devices: p.devices })
          : lastOff ? L(`Visto por último ${relTime(lastOff.at)}`, `Last seen ${relTime(lastOff.at)}`)
          : friend ? "Offline" : L("Sem status (não é amigo)", "No status (not a friend)");
        return h("button", { key: id, className: "dmtt-row", onClick: () => nav.push({ type: "vipPerson", userId: id }) },
          h(Avatar, { userId: id, status, size: 36 }),
          h("span", { className: "dmtt-row-main" },
            h("span", { className: "dmtt-row-title" }, nameOf(id, list[id])),
            h("span", { className: "dmtt-row-sub" }, joinNodes([now, changes ? L(`${changes} apagadas/editadas`, `${changes} deleted/edited`) : null]))),
          ms >= 60000 ? h("span", { className: "dmtt-row-side" },
            h("span", { className: "dmtt-row-detail dmtt-num" }, fmtDur(ms)),
            h("span", { className: "dmtt-row-time" }, L("online hoje", "online today"))) : null,
          h("span", { className: "dmtt-chev" }, h(Icon, { d: ICON_CHEVRON, size: 14 })));
      })));
}

function MessagesFeed({ channelId }) {
  useBus(vipBus, settingsBus);
  const nav = useNav();
  const [seenBefore] = React.useState(getDeletedSeen);
  React.useEffect(() => { markDeletedSeen(); }, []);
  const all = vipChanges();
  const here = channelId ? all.filter((m) => m.channelId === channelId) : [];
  const [where, setWhere] = React.useState(here.length ? "here" : "all");
  const [kind, setKind] = React.useState("all");
  const [limit, setLimit] = React.useState(40);
  const vips = Object.keys(getVipList()).length;
  if (!vips) return null;
  if (!getSettings().vipRecordMessages) {
    return h(React.Fragment, null,
      h(Group, { footer: L("Para ver o que os VIPs apagam e editam, o registro de mensagens precisa estar ligado.", "To see what VIPs delete and edit, message logging needs to be on.") },
        h(NavRow, { icon: "star", color: "#ffcc00", title: L("Ligar registro de mensagens", "Turn on message logging"), onClick: () => nav.push({ type: "settingsPage", id: "vip" }) })));
  }
  const ch = channelId ? ChannelStore?.getChannel?.(channelId) : null;
  const hereLabel = ch ? (ch.guild_id ? `#${ch.name}` : ch.type === 3 ? channelLabel(ch) : L("Esta conversa", "This chat")) : null;
  let list = where === "here" ? here : all;
  const nDel = list.filter((m) => m.deletedAt).length;
  const nEd = list.filter((m) => m.edits?.length).length;
  if (kind === "deleted") list = list.filter((m) => m.deletedAt);
  if (kind === "edited") list = list.filter((m) => m.edits?.length);
  return h(React.Fragment, null,
    here.length ? h(Segmented, { value: where, onChange: setWhere, options: [["here", hereLabel, here.length], ["all", L("Todos os lugares", "Everywhere"), all.length]] }) : null,
    h(Segmented, { value: kind, onChange: (v) => { setKind(v); setLimit(40); }, options: [["all", L("Tudo", "All")], ["deleted", L("Apagadas", "Deleted"), nDel], ["edited", L("Editadas", "Edited"), nEd]] }),
    list.length ? h(DayList, { items: list.slice(0, limit), getTime: lastChangeAt, render: (m) => h(ChangeCard, { key: m.id, m, isNew: lastChangeAt(m) > seenBefore, showPlace: where === "all" }) })
      : h(Empty, { icon: "clock", title: L("Nada por aqui", "Nothing here") }, L("Quando um VIP apagar ou editar uma mensagem, aparece aqui.", "When a VIP deletes or edits a message, it shows up here.")),
    list.length > limit ? h("button", { className: "dmtt-more", onClick: () => setLimit(limit + 40) }, L("Mostrar mais", "Show more")) : null);
}
function ChangeCard({ m, isNew, showPlace }) {
  const [open, setOpen] = React.useState(false);
  const nav = useNav();
  const edits = m.edits || [];
  const deleted = !!m.deletedAt;
  const current = edits.length ? edits[edits.length - 1].content : m.content;
  const body = (deleted ? current : current) || (m.attachments?.length ? `[${m.attachments.map((a) => a.name).join(", ")}]` : NO_TEXT());
  const action = deleted ? (edits.length ? L("editou e depois apagou", "edited, then deleted") : L("apagou", "deleted")) : L(`editou ${edits.length > 1 ? `${edits.length}×` : ""}`, `edited${edits.length > 1 ? ` ${edits.length}×` : ""}`);
  const place = m.guildId ? `#${m.channelName || L("canal", "channel")} · ${m.guildName || ""}` : m.channelName ? L(`Grupo ${m.channelName}`, `Group ${m.channelName}`) : L("Privado", "DM");
  return h(MessageCard, {
    avatar: h("button", { className: "dmtt-avbtn", title: L("Ver perfil VIP", "Open VIP profile"), onClick: () => nav.push({ type: "vipPerson", userId: m.userId }) }, h(Avatar, { userId: m.userId, size: 32 })),
    name: h("span", null, isNew ? h("span", { className: "dmtt-newdot", title: L("Novo", "New") }) : null, nameOf(m.userId, getVipList()[m.userId] || {})),
    action,
    meta: joinNodes([showPlace ? place : null, deleted ? L(`apagada ${fmtHM(m.deletedAt)} · ficou ${fmtDur(m.deletedAt - m.createdAt)} no ar`, `deleted ${fmtHM(m.deletedAt)} · up for ${fmtDur(m.deletedAt - m.createdAt)}`) : null]),
    time: fmtHM(m.createdAt),
    body, bodyTone: deleted ? "deleted" : null,
    extra: edits.length ? h(React.Fragment, null,
      h("button", { className: "dmtt-link", onClick: () => setOpen(!open) }, open ? L("Esconder versões", "Hide versions") : L(`Ver ${edits.length + 1} versões`, `See ${edits.length + 1} versions`)),
      open ? h("div", { className: "dmtt-quote" },
        h("div", null, h("b", null, `${L("Original", "Original")} · ${fmtHM(m.createdAt)}: `), m.content || NO_TEXT()),
        edits.map((e, i) => h("div", { key: i }, h("b", null, `${fmtHM(e.at)}: `), e.content || NO_TEXT()))) : null) : null,
    onJump: deleted ? null : () => jumpTo(m.guildId, m.channelId, m.id),
  });
}

/* ================================================================== */
/* Tela: Lista VIP                                                      */
/* ================================================================== */
function vipStatusNow(id) {
  const p = rawPresence(id);
  const friend = isFriendOf(id);
  const st = effectiveStatus(p, friend);
  return { p, friend, status: st === "offline" && !friend ? "unknown" : st };
}
const lastPresenceEvent = (id, events) => events.find((e) => e.userId === id && e.type === "presence");

function VipAddById({ onAdded }) {
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null);
  const submit = async () => {
    if (!value.trim() || busy) return;
    setBusy(true); setMsg(null);
    const r = await addVipById(value);
    setBusy(false);
    if (r.ok) { setValue(""); setMsg({ ok: true, text: L(`${r.name} entrou na Lista VIP.`, `${r.name} was added to your VIP list.`) }); onAdded?.(r.id); }
    else setMsg({ ok: false, text: r.msg });
  };
  return h(Group, { header: L("Adicionar por ID", "Add by ID"), footer: msg ? null : L("Cole o ID do Discord da pessoa (Configurações → Avançado → Modo desenvolvedor, depois botão direito → Copiar ID). Também aceita menção ou link do perfil.", "Paste the person's Discord ID (Settings → Advanced → Developer Mode, then right-click → Copy User ID). A mention or profile link works too.") },
    h("div", { className: "dmtt-row dmtt-addid" },
      h("input", { className: "dmtt-text", value, placeholder: L("ID do Discord", "Discord user ID"), onChange: (e) => { setValue(e.target.value); setMsg(null); }, onKeyDown: (e) => { if (e.key === "Enter") submit(); } }),
      h("button", { className: "dmtt-btn-primary", disabled: busy || !value.trim(), onClick: submit }, busy ? L("Buscando…", "Looking up…") : L("Adicionar", "Add"))),
    msg ? h("div", { className: `dmtt-row dmtt-addid-msg ${msg.ok ? "is-ok" : "is-err"}` }, msg.text) : null);
}

function VipScreen() {
  useBus(vipBus);
  useTicker(30000);
  const nav = useNav();
  const [q, setQ] = React.useState("");
  const list = getVipList();
  const d = loadVip();
  const all = Object.keys(list);
  if (!all.length) {
    return h(React.Fragment, null, h(LargeTitle, { title: NAMES.vip() }),
      h(Empty, { icon: "star", title: L("Sua Lista VIP está vazia", "Your VIP list is empty") }, L("Adicione pelo ID abaixo ou clicando com o botão direito em alguém → \"Lista VIP\". Você passa a ver quando a pessoa fica online, offline ou invisível, as calls, e o que ela manda, edita e apaga.", "Add someone by ID below, or right-click a person → \"VIP list\". You'll see when they go online, offline or invisible, their calls, and what they send, edit and delete.")),
      h(VipAddById, { onAdded: (id) => nav.push({ type: "vipPerson", userId: id }) }));
  }
  let ids = all;
  if (q.trim()) { const s = q.trim().toLowerCase(); ids = ids.filter((id) => [nameOf(id, list[id]), usernameOf(id), id].some((v) => v && String(v).toLowerCase().includes(s))); }
  const rank = (id) => (vipVoice.has(id) ? 0 : (rawPresence(id)?.status || "offline") !== "offline" ? 1 : 2);
  const lastAt = (id) => d.events.find((e) => e.userId === id)?.at || 0;
  ids.sort((a, b) => rank(a) - rank(b) || lastAt(b) - lastAt(a));
  const online = all.filter((id) => rank(id) < 2).length;
  return h(React.Fragment, null,
    h(LargeTitle, { title: NAMES.vip(), subtitle: L(`${online} de ${all.length} online`, `${online} of ${all.length} online`) }),
    all.length > 6 ? h(Search, { value: q, onChange: setQ }) : null,
    h(Group, null, ids.map((id) => {
      const { p, friend, status } = vipStatusNow(id);
      const last = lastPresenceEvent(id, d.events);
      const lv = vipVoice.get(id);
      const deleted = d.messages.filter((m) => m.userId === id && m.deletedAt).length;
      let sub;
      if (lv) sub = [h("span", { className: "dmtt-live-inline" }, L(`Em call · ${lv.guildId ? `#${lv.channelName || "canal"}` : "privado"}`, `In a call · ${lv.guildId ? `#${lv.channelName || "channel"}` : "DM"}`))];
      else if (p && p.status !== "offline") sub = [h(StatusWithDevices, { text: STATUS_PT[p.status], devices: p.devices }), last && last.to === p.status ? L(`há ${fmtDur(Date.now() - last.at)}`, `for ${fmtDur(Date.now() - last.at)}`) : null];
      else if (last?.to === "offline") sub = [L(`Visto por último ${relTime(last.at)}`, `Last seen ${relTime(last.at)}`)];
      else sub = [friend ? "Offline" : L("Sem status (não é amigo)", "No status (not a friend)")];
      if (deleted) sub.push(L(`${deleted} ${plural(deleted, "apagada", "apagadas")}`, `${deleted} deleted`));
      return h(NavRow, { key: id, avatar: h(Avatar, { userId: id, status }), title: nameOf(id, list[id]), subtitle: joinNodes(sub), onClick: () => nav.push({ type: "vipPerson", userId: id }) });
    })),
    h(VipAddById, null),
    h("div", { className: "dmtt-sec-f" }, L("Também dá pra adicionar com o botão direito na pessoa → Lista VIP.", "You can also right-click a person → VIP list.")));
}

const PRESENCE_VERB = labelMap(
  { online: "Ficou online", idle: "Ficou ausente", dnd: "Ativou não perturbar", offline: "Ficou offline", streaming: "Começou a transmitir" },
  { online: "Went online", idle: "Went idle", dnd: "Turned on Do Not Disturb", offline: "Went offline", streaming: "Started streaming" });
function ActivityList({ id, events }) {
  const mine = events.filter((e) => e.userId === id);
  if (!mine.length) return h(Empty, { icon: "sparkle", title: L("Sem atividade ainda", "No activity yet") }, isFriendOf(id) ? L("As mudanças de status aparecem aqui assim que acontecerem.", "Status changes show up here as they happen.") : L("Essa pessoa não é sua amiga: o Discord só manda o status dela se vocês estiverem num servidor em comum.", "This person isn't your friend: Discord only sends their status if you share a server."));
  const presence = mine.filter((e) => e.type === "presence");
  const durationOf = (e) => { const i = presence.indexOf(e); if (i < 0) return null; const newer = i > 0 ? presence[i - 1] : null; return newer ? L(`por ${fmtDur(newer.at - e.at)}`, `for ${fmtDur(newer.at - e.at)}`) : L(`há ${fmtDur(Date.now() - e.at)}`, `${fmtDur(Date.now() - e.at)} ago`); };
  return h(DayList, { items: mine, getTime: (e) => e.at, render: (e, i) => e.type === "invisible"
    ? h("div", { key: `${e.at}-${i}`, className: "dmtt-row" },
        h("span", { className: "dmtt-tl-dot dmtt-dot-invisible" }),
        h("span", { className: "dmtt-row-main" }, h("span", { className: "dmtt-row-title" }, h("span", { className: "dmtt-num dmtt-time-lead" }, fmtHM(e.at)), L("Visto invisível", "Seen while invisible")),
          h("span", { className: "dmtt-row-sub" }, e.via === "typing" ? L(`Digitando ${e.where ? `em ${e.where}` : "pra você"}`, `Typing ${e.where ? `in ${e.where}` : "to you"}`) : L(`Mandou mensagem ${e.where ? `em ${e.where}` : "pra você"}`, `Sent a message ${e.where ? `in ${e.where}` : "to you"}`))))
    : h("div", { key: `${e.at}-${i}`, className: "dmtt-row" },
        h("span", { className: `dmtt-tl-dot dmtt-dot-${e.to}` }),
        h("span", { className: "dmtt-row-main" }, h("span", { className: "dmtt-row-title" }, h("span", { className: "dmtt-num dmtt-time-lead" }, fmtHM(e.at)), PRESENCE_VERB[e.to] || e.to),
          h("span", { className: "dmtt-row-sub" }, joinNodes([durationOf(e), e.devices?.length && e.to !== "offline" ? h(Devices, { devices: e.devices }) : null])))) });
}
function MessagesList({ id, messages }) {
  const [onlyChanged, setOnlyChanged] = React.useState(false);
  const [where, setWhere] = React.useState("all");
  const [limit, setLimit] = React.useState(50);
  let mine = messages.filter((m) => m.userId === id);
  const changed = mine.filter((m) => m.deletedAt || m.edits?.length).length;
  if (where === "guild") mine = mine.filter((m) => m.guildId);
  if (where === "dm") mine = mine.filter((m) => !m.guildId);
  if (onlyChanged) mine = mine.filter((m) => m.deletedAt || m.edits?.length);
  return h(React.Fragment, null,
    h("div", { className: "dmtt-row2" },
      h(Segmented, { value: onlyChanged ? "c" : "a", onChange: (v) => setOnlyChanged(v === "c"), options: [["a", L("Todas", "All")], ["c", L("Apagadas/editadas", "Deleted/edited"), changed]] }),
      h(Segmented, { value: where, onChange: setWhere, options: [["all", L("Tudo", "Everywhere")], ["guild", L("Servidores", "Servers")], ["dm", L("Privado", "DMs")]] })),
    mine.length ? h(DayList, { items: mine.slice(0, limit), getTime: (m) => m.createdAt, render: (m) => {
      const edited = m.edits?.length > 0;
      const current = edited ? m.edits[m.edits.length - 1].content : m.content;
      const body = current || (m.attachments?.length ? "" : m.stickers?.length ? L(`[figurinha: ${m.stickers.join(", ")}]`, `[sticker: ${m.stickers.join(", ")}]`) : NO_TEXT());
      return h(MessageEntry, { key: m.id, m, body, edited });
    } }) : h(Empty, { icon: "at", title: onlyChanged ? L("Nada apagado ou editado", "Nothing deleted or edited") : L("Nenhuma mensagem ainda", "No messages yet") }),
    mine.length > limit ? h("button", { className: "dmtt-more", onClick: () => setLimit(limit + 50) }, L("Mostrar mais", "Show more")) : null);
}
function MessageEntry({ m, body, edited }) {
  const [open, setOpen] = React.useState(false);
  const place = m.guildId ? `#${m.channelName || L("canal", "channel")} · ${m.guildName || ""}` : m.channelName ? L(`Grupo ${m.channelName}`, `Group ${m.channelName}`) : L("Privado", "DM");
  return h("div", { className: "dmtt-card" },
    h("div", { className: "dmtt-card-head" },
      h("span", { className: "dmtt-row-main" }, h("span", { className: "dmtt-row-sub dmtt-strong" }, place)),
      m.deletedAt ? h("span", { className: "dmtt-tag is-red", title: fmtDate(m.deletedAt) }, L(`Apagada ${fmtHM(m.deletedAt)}`, `Deleted ${fmtHM(m.deletedAt)}`)) : null,
      edited ? h("button", { className: "dmtt-tag is-btn", onClick: () => setOpen(!open) }, L(`Editada ${m.edits.length}×`, `Edited ${m.edits.length}×`)) : null,
      h("span", { className: "dmtt-row-time" }, fmtHM(m.createdAt))),
    body ? h("div", { className: `dmtt-bubble ${m.deletedAt ? "is-deleted" : ""}` }, body) : null,
    m.attachments?.length ? h("div", { className: "dmtt-files" }, m.attachments.map((a, i) => h("a", { key: i, href: a.url, target: "_blank", rel: "noreferrer" }, a.name || L("anexo", "attachment")))) : null,
    open ? h("div", { className: "dmtt-quote" }, h("div", null, h("b", null, L("Original: ", "Original: ")), m.content || NO_TEXT()), m.edits.map((e, i) => h("div", { key: i }, h("b", null, `${fmtHM(e.at)}: `), e.content || NO_TEXT()))) : null,
    !m.deletedAt ? h("button", { className: "dmtt-link", onClick: () => jumpTo(m.guildId, m.channelId, m.id) }, L("Ir para mensagem", "Jump to message")) : null);
}

/* ---------- voz ---------- */
function PeerStack({ peers, max = 4 }) {
  if (!peers?.length) return null;
  return h("span", { className: "dmtt-peers", title: peers.map((p) => p.name).join(", ") },
    peers.slice(0, max).map((p) => h("img", { key: p.id, src: p.avatarURL || avatarOf(UserStore?.getUser?.(p.id), p.id), alt: "" })),
    peers.length > max ? h("span", { className: "dmtt-peers-more" }, `+${peers.length - max}`) : null);
}
const FLAG_ICON = {
  muted: "M2 2l20 20M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6M17 16.95A7 7 0 0 1 5 12v-2M19 10v2a7 7 0 0 1-.11 1.23M12 19v3M8 22h8",
  deafened: "M2 2l20 20M3 18v-6a9 9 0 0 1 14.2-7.35M21 12v6M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3",
  streamed: "M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 21h8M12 17v4M12 13V7M9 10l3-3 3 3",
  video: "M23 7l-7 5 7 5V7zM3 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
};
const FLAG_TITLE = labelMap(
  { muted: "Microfone mutado", deafened: "Áudio desativado", streamed: "Transmitindo a tela", video: "Câmera ligada" },
  { muted: "Muted", deafened: "Deafened", streamed: "Screen sharing", video: "Camera on" });
const FLAG_EVENT = (flag, on) => ({
  muted: on ? L("Mutou o microfone", "Muted") : L("Desmutou o microfone", "Unmuted"),
  deafened: on ? L("Desativou o áudio", "Deafened") : L("Ativou o áudio", "Undeafened"),
  streamed: on ? L("Começou a transmitir a tela", "Started screen sharing") : L("Parou de transmitir", "Stopped screen sharing"),
  video: on ? L("Ligou a câmera", "Turned camera on") : L("Desligou a câmera", "Turned camera off"),
}[flag] || flag);
function FlagIcon({ flag, size = 13 }) { return h("span", { className: `dmtt-device dmtt-flag-${flag}`, title: FLAG_TITLE[flag] }, h(SIcon, { d: FLAG_ICON[flag], size })); }
function VoiceFlags({ v, live }) {
  const src = live && v.now ? v.now : v;
  const on = Object.keys(FLAG_ICON).filter((f) => src[f]);
  return on.length ? h("span", { className: "dmtt-devices" }, on.map((f) => h(FlagIcon, { key: f, flag: f }))) : null;
}
function liveFlagsOf(userId) {
  const vs = normVS(safe(() => VoiceStateStore?.getVoiceStateForUser?.(userId)));
  return vs ? { muted: vs.selfMute || vs.mute, deafened: vs.selfDeaf || vs.deaf, streamed: vs.selfStream, video: vs.selfVideo } : null;
}
const withN = (n) => L(`com ${n}`, `with ${n}`);
const alone = () => L("sozinho", "alone");
function VoiceDetail({ v, live, vipId }) {
  const end = live ? Date.now() : v.leftAt;
  const peers = live
    ? [...new Set([...v.peers, ...usersInChannel(v.channelId)])].filter((pid) => pid !== vipId).map((pid) => {
        const u = UserStore?.getUser?.(pid); const log = v.peerLog?.[pid] || {};
        return { id: pid, name: nameOf(pid), username: u?.username, avatarURL: avatarOf(u, pid), joinedAt: log.joinedAt || v.joinedAt, leftAt: log.leftAt || null, already: !!log.already };
      })
    : (v.peers || []);
  const timeline = [
    { at: v.joinedAt, text: v.already ? L("Já estava na call quando o Lurk começou", "Was already in the call when Lurk started") : L("Entrou na call", "Joined the call") },
    ...(v.events || []).map((e) => ({ at: e.at, flag: e.flag, on: e.on, text: FLAG_EVENT(e.flag, e.on) })),
    ...(!live ? [{ at: v.leftAt, text: v.cut ? L("Fim do registro (Discord fechado)", "Recording ended (Discord closed)") : L("Saiu da call", "Left the call") }] : []),
  ].sort((a, b) => a.at - b.at);
  return h("div", { className: "dmtt-sub dmtt-vdetail" },
    h("div", { className: "dmtt-mini-h" }, L(`Quem estava · ${peers.length}`, `Who was there · ${peers.length}`)),
    peers.length ? peers.map((p) => {
      const flags = live && !p.leftAt ? liveFlagsOf(p.id) : null;
      const range = p.joinedAt ? joinNodes([
        p.already || p.joinedAt <= v.joinedAt ? L("já estava", "already there") : L(`entrou ${fmtHM(p.joinedAt)}`, `joined ${fmtHM(p.joinedAt)}`),
        p.leftAt ? L(`saiu ${fmtHM(p.leftAt)}`, `left ${fmtHM(p.leftAt)}`) : live ? L("na call", "in the call") : L("até o fim", "until the end")]) : null;
      return h("div", { key: p.id, className: `dmtt-vpeer ${p.leftAt ? "is-gone" : ""}` },
        h(Avatar, { userId: p.id, url: p.avatarURL, size: 26 }),
        h("span", { className: "dmtt-row-main" },
          h("span", { className: "dmtt-row-title dmtt-small" }, p.name || nameOf(p.id), p.username ? h("span", { className: "dmtt-row-user" }, ` @${p.username}`) : null),
          range ? h("span", { className: "dmtt-row-sub" }, range) : null),
        flags ? h("span", { className: "dmtt-devices" }, Object.keys(FLAG_ICON).filter((f) => flags[f]).map((f) => h(FlagIcon, { key: f, flag: f }))) : null,
        isVip(p.id) ? h("span", { className: "dmtt-tag" }, "VIP") : null);
    }) : h("div", { className: "dmtt-muted dmtt-small" }, L("Ficou sozinho na call.", "Was alone in the call.")),
    h("div", { className: "dmtt-mini-h" }, L("Linha do tempo", "Timeline")),
    timeline.map((t, i) => h("div", { key: i, className: "dmtt-vt" },
      h("span", { className: "dmtt-num dmtt-muted" }, fmtTime(t.at)),
      t.flag ? h(FlagIcon, { flag: t.flag }) : h("span", { className: "dmtt-vt-dot" }),
      h("span", { className: t.flag && !t.on ? "dmtt-muted" : null }, t.text))),
    h("div", { className: "dmtt-vt-foot" },
      h("span", { className: "dmtt-muted" }, L(`${fmtDur(end - v.joinedAt)} no total`, `${fmtDur(end - v.joinedAt)} total`)),
      h("button", { className: "dmtt-link", onClick: () => jumpTo(v.guildId, v.channelId) }, L("Abrir canal", "Open channel"))));
}
function VoiceSessionRow({ v, vipId }) {
  const [open, setOpen] = React.useState(false);
  return h("div", { className: `dmtt-cell ${open ? "is-open" : ""}` },
    h("div", { className: "dmtt-row", style: { cursor: "pointer" }, onClick: () => setOpen(!open) },
      h("span", { className: "dmtt-tl-dot dmtt-dot-online" }),
      h("span", { className: "dmtt-row-main" },
        h("span", { className: "dmtt-row-title dmtt-num" }, `${fmtHM(v.joinedAt)} – ${fmtHM(v.leftAt)}`),
        h("span", { className: "dmtt-row-sub" }, joinNodes([`${v.already ? "≥ " : ""}${fmtDur(v.leftAt - v.joinedAt)}`, placeLabel(v), v.peers?.length ? withN(v.peers.length) : alone(), h(VoiceFlags, { v }), v.cut ? L("até o Discord fechar", "until Discord closed") : null]))),
      h(PeerStack, { peers: v.peers }),
      h("span", { className: "dmtt-chev dmtt-chev-rot" }, h(Icon, { d: ICON_CHEVRON, size: 14 }))),
    open ? h(VoiceDetail, { v, vipId }) : null);
}
function VoiceList({ id, sessions: list }) {
  useTicker(30000);
  const [liveOpen, setLiveOpen] = React.useState(true);
  const live = vipVoice.get(id);
  const mine = list.filter((v) => v.userId === id);
  if (!getSettings().vipTrackVoice && !mine.length) return h(Empty, { icon: "headset", title: L("Registro de calls desligado", "Call tracking is off") }, L("Ative em Ajustes → Lista VIP.", "Turn it on in Settings → VIP list."));
  const livePeers = live ? [...new Set([...live.peers, ...usersInChannel(live.channelId)])].filter((pid) => pid !== id).map((pid) => ({ id: pid, name: nameOf(pid) })) : [];
  const total = mine.reduce((n, v) => n + (v.leftAt - v.joinedAt), 0);
  return h(React.Fragment, null,
    live ? h(Group, { header: L("Agora", "Now") }, h("div", { className: `dmtt-cell is-live ${liveOpen ? "is-open" : ""}` },
      h("div", { className: "dmtt-row", style: { cursor: "pointer" }, onClick: () => setLiveOpen(!liveOpen) },
        h("span", { className: "dmtt-live-dot" }),
        h("span", { className: "dmtt-row-main" },
          h("span", { className: "dmtt-row-title" }, L(`Em call · ${placeLabel(live)}`, `In a call · ${placeLabel(live)}`)),
          h("span", { className: "dmtt-row-sub" }, joinNodes([`${live.already ? "≥ " : ""}${fmtDur(Date.now() - live.joinedAt)}`, livePeers.length ? withN(livePeers.length) : alone(), h(VoiceFlags, { v: live, live: true })]))),
        h(PeerStack, { peers: livePeers }),
        h("span", { className: "dmtt-chev dmtt-chev-rot" }, h(Icon, { d: ICON_CHEVRON, size: 14 }))),
      liveOpen ? h(VoiceDetail, { v: live, live: true, vipId: id }) : null)) : null,
    mine.length ? h("div", { className: "dmtt-sec-f dmtt-sec-f-top" }, L(`${mine.length} ${plural(mine.length, "call", "calls")} · ${fmtDur(total)} no total · toque numa call pra ver quem estava`, `${mine.length} ${plural(mine.length, "call", "calls")} · ${fmtDur(total)} total · tap a call to see who was there`)) : null,
    mine.length ? h(DayList, { items: mine, getTime: (v) => v.joinedAt, render: (v) => h(VoiceSessionRow, { key: `${v.joinedAt}-${v.channelId}`, v, vipId: id }) })
      : !live ? h(Empty, { icon: "headset", title: L("Nenhuma call ainda", "No calls yet") }) : null);
}

// "Avisar quando" recolhido: uma linha com resumo que expande ao clicar
function VipAlerts({ id, toggles }) {
  const [open, setOpen] = React.useState(false);
  const on = toggles.filter(([f]) => vipFlag(id, f));
  const summary = !on.length ? L("Nenhum aviso", "No alerts") : on.length === toggles.length ? L("Todos ligados", "All on") : L(`${on.length} de ${toggles.length} ligados`, `${on.length} of ${toggles.length} on`);
  return h(Group, { footer: open ? L("Como o aviso chega (Discord, Windows, som) fica em Ajustes → Avisos.", "How you're notified (Discord, Windows, sound) is in Settings → Notifications.") : null },
    h("div", { className: `dmtt-cell ${open ? "is-open" : ""}` },
      h("div", { className: "dmtt-row", style: { cursor: "pointer" }, onClick: () => setOpen(!open) },
        h(IconTile, { name: "bell", color: "#ff453a", size: 26 }),
        h("span", { className: "dmtt-row-main" }, h("span", { className: "dmtt-row-title" }, L("Avisar quando", "Notify me when")), !open && on.length && on.length < toggles.length ? h("span", { className: "dmtt-row-sub" }, on.map(([, l]) => l).join(" · ")) : null),
        h("span", { className: "dmtt-row-detail" }, summary),
        h("span", { className: "dmtt-chev dmtt-chev-rot" }, h(Icon, { d: ICON_CHEVRON, size: 14 })))),
    open ? toggles.map(([f, l]) => h("div", { key: f, className: "dmtt-row", style: { cursor: "pointer" }, onClick: () => setVip(id, { [f]: !vipFlag(id, f) }) },
      h("span", { className: "dmtt-row-main" }, h("span", { className: "dmtt-row-title" }, l)),
      h(Switch, { checked: vipFlag(id, f), onChange: (v) => setVip(id, { [f]: v }), label: l }))) : null);
}
function VipPersonScreen({ userId: id }) {
  useBus(vipBus, historyBus);
  useTicker(30000);
  const nav = useNav();
  const [tab, setTab] = React.useState(vipVoice.has(id) ? "voice" : "activity");
  const d = loadVip();
  const entry = getVipList()[id];
  if (!entry) return h(Empty, { icon: "star", title: L("Não está mais na Lista VIP", "No longer on your VIP list") });
  const { p, friend, status } = vipStatusNow(id);
  const typing = getHistory().filter((r) => r.userId === id).sort((a, b) => b.lastTypingAt - a.lastTypingAt);
  const mine = d.messages.filter((m) => m.userId === id);
  const invis = d.events.filter((e) => e.userId === id && e.type === "invisible").length;
  const chips = [friend ? L("Amigo", "Friend") : friend === false ? L("Não é amigo", "Not a friend") : null, vipVoice.has(id) ? L("Em call agora", "In a call now") : p && p.status !== "offline" ? h(StatusWithDevices, { text: STATUS_PT[p.status], devices: p.devices }) : null].filter(Boolean);
  const dm = ChannelStore?.getDMFromUserId?.(id);
  const toggles = [["notifyOnline", L("Ficar online", "They come online")], ["notifyTyping", L("Começar a digitar", "They start typing")], ["notifyInvisible", L("For visto invisível", "They're seen invisible")], ["notifyVoice", L("Entrar em call", "They join a call")]];
  return h(React.Fragment, null,
    h(Hero, { userId: id, status, name: nameOf(id, entry), username: usernameOf(id), chips },
      h(ActionButton, { icon: h(SIcon, { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z", size: 18 }), label: L("Mensagem", "Message"), onClick: () => openDM(dm, id, false) }),
      typing.length ? h(ActionButton, { icon: h(SIcon, { d: SI.keyboard, size: 18 }), label: NAMES.typing(), onClick: () => nav.push({ type: "person", userId: id }) }) : null,
      h(ActionButton, { icon: h(SIcon, { d: SI.star, size: 18 }), label: L("Remover", "Remove"), tone: "danger", onClick: () => confirmDanger(L("Remover da Lista VIP", "Remove from VIP list"), L(`Remover ${nameOf(id, entry)}? O histórico de status, calls e mensagens dela também será apagado.`, `Remove ${nameOf(id, entry)}? Their status, call and message history will be deleted too.`), () => { deleteVipData(id); setVip(id, null); nav.pop(); }, L("Remover", "Remove")) })),
    h(Stats, { items: [[(() => { const ms = onlineMs(id, d.events, startOfDay(Date.now())); return ms >= 60000 ? fmtDur(ms) : L("0 min", "0 min"); })(), L("online hoje", "online today")], [mine.filter((m) => m.deletedAt).length, L("apagadas", "deleted")], [invis, L("invisível", "invisible")], [(d.voice || []).filter((v) => v.userId === id).length, "calls"]] }),
    h(VipAlerts, { id, toggles }),
    h(Segmented, { value: tab, onChange: setTab, options: [["activity", L("Atividade", "Activity")], ["messages", L("Mensagens", "Messages")], ["voice", vipVoice.has(id) ? "Calls ●" : "Calls"], ["typing", L("Digitou", "Typed")]] }),
    tab === "activity" ? h(ActivityList, { id, events: d.events })
      : tab === "messages" ? h(MessagesList, { id, messages: d.messages })
      : tab === "voice" ? h(VoiceList, { id, sessions: d.voice || [] })
      : typing.length ? h(DayList, { items: typing, getTime: (r) => r.lastTypingAt, render: (r) => h(SessionRow, { key: r.id, r, showWhere: true }) }) : h(Empty, { icon: "keyboard", title: L("Nunca digitou e apagou", "Never typed & quit") }));
}

/* ================================================================== */
/* Tela: Tempo em call                                                  */
/* ================================================================== */
function CallsScreen() {
  useBus(callBus, settingsBus);
  useTicker(30000);
  const nav = useNav();
  const [onlyFriends, setOnlyFriends] = React.useState(false);
  let totals = callTotals();
  if (onlyFriends) totals = totals.filter((t) => isFriendOf(t.id));
  const max = totals[0]?.ms || 1;
  const live = myCall.sess;
  const livePeers = live ? Object.entries(live.peers).filter(([, p]) => p.since != null).map(([id]) => ({ id, name: nameOf(id) })) : [];
  if (!getSettings().trackMyCalls && !totals.length) {
    return h(React.Fragment, null, h(LargeTitle, { title: NAMES.calls() }), h(Group, null, h(NavRow, { icon: "headset", color: "#bf5af2", title: L("Ativar registro das suas calls", "Turn on call tracking"), onClick: () => nav.push({ type: "settingsPage", id: "calls" }) })));
  }
  return h(React.Fragment, null,
    h(LargeTitle, { title: NAMES.calls(), subtitle: L("Quanto tempo você passou em call com cada pessoa", "How long you've spent in calls with each person") }),
    live ? h(Group, { header: L("Agora", "Now") }, h("div", { className: "dmtt-row" },
      h("span", { className: "dmtt-live-dot" }),
      h("span", { className: "dmtt-row-main" }, h("span", { className: "dmtt-row-title" }, L(`Você está em call · ${placeLabel(live)}`, `You're in a call · ${placeLabel(live)}`)), h("span", { className: "dmtt-row-sub" }, joinNodes([`${live.already ? "≥ " : ""}${fmtDur(Date.now() - live.joinedAt)}`, livePeers.length ? withN(livePeers.length) : alone()]))),
      h(PeerStack, { peers: livePeers }))) : null,
    h(Segmented, { value: onlyFriends ? "f" : "a", onChange: (v) => setOnlyFriends(v === "f"), options: [["a", L("Todos", "Everyone")], ["f", L("Só amigos", "Friends only")]] }),
    totals.length ? h(Group, null, totals.slice(0, 100).map((t, i) => h("button", { key: t.id, className: "dmtt-row", onClick: () => nav.push({ type: "callPerson", userId: t.id }) },
      h("span", { className: "dmtt-rank" }, i + 1),
      h(Avatar, { userId: t.id, url: t.avatarURL, size: 34 }),
      h("span", { className: "dmtt-row-main" },
        h("span", { className: "dmtt-row-title" }, nameOf(t.id, t)),
        h("span", { className: "dmtt-bar" }, h("span", { style: { width: `${Math.max(4, (t.ms / max) * 100)}%` } })),
        h("span", { className: "dmtt-row-sub" }, L(`${t.calls} ${plural(t.calls, "call", "calls")} · última ${relTime(t.lastAt)}`, `${t.calls} ${plural(t.calls, "call", "calls")} · last ${relTime(t.lastAt)}`))),
      h("span", { className: "dmtt-row-detail dmtt-num" }, fmtDur(t.ms)),
      h("span", { className: "dmtt-chev" }, h(Icon, { d: ICON_CHEVRON, size: 14 })))))
      : h(Empty, { icon: "headset", title: L("Nenhuma call registrada", "No calls recorded") }, L("Entre numa call com alguém e o tempo começa a contar.", "Join a call with someone and the clock starts.")));
}
function CallPersonScreen({ userId }) {
  useBus(callBus);
  const sessions = loadCalls().sessions.filter((s) => (s.peers || []).some((p) => p.id === userId));
  const t = callTotals().find((x) => x.id === userId);
  return h(React.Fragment, null,
    h(Hero, { userId, url: t?.avatarURL, name: nameOf(userId, t || {}), username: usernameOf(userId, t || {}) }),
    h(Stats, { items: [[t ? fmtDur(t.ms) : "0", L("em call juntos", "together in calls")], [t?.calls || 0, "calls"], [t ? relTime(t.lastAt) : "—", L("última", "last")]] }),
    sessions.length ? h(DayList, { items: sessions, getTime: (s) => s.joinedAt, render: (s, i) => {
      const p = s.peers.find((x) => x.id === userId);
      const others = s.peers.length - 1;
      return h("div", { key: `${s.joinedAt}-${i}`, className: "dmtt-row" },
        h("span", { className: "dmtt-tl-dot dmtt-dot-online" }),
        h("span", { className: "dmtt-row-main" },
          h("span", { className: "dmtt-row-title dmtt-num" }, `${fmtHM(s.joinedAt)} – ${fmtHM(s.leftAt)}`),
          h("span", { className: "dmtt-row-sub" }, joinNodes([placeLabel(s), L(`${fmtDur(p.ms)} juntos`, `${fmtDur(p.ms)} together`), others > 0 ? L(`+${others} ${plural(others, "pessoa", "pessoas")}`, `+${others} ${plural(others, "person", "people")}`) : null]))),
        h(PeerStack, { peers: s.peers.filter((x) => x.id !== userId) }));
    } }) : h(Empty, { icon: "headset", title: L("Sem calls registradas", "No calls recorded") }, myCall.sess?.peers?.[userId] ? L("Vocês estão em call agora. Aparece aqui quando a call terminar.", "You're in a call right now. It shows up here when it ends.") : null));
}

/* ================================================================== */
/* Ajustes                                                              */
/* ================================================================== */
const sw = (id, label, note) => ({ id, label, note, type: "switch" });
const num = (id, label, min, max, step, unit, note) => ({ id, label, note, type: "number", min, max, step, unit });
const channelsRows = (prefix) => [sw(`${prefix}Toast`, L("Aviso no Discord", "In-app notification")), sw(`${prefix}Desktop`, L("Notificação do Windows", "Desktop notification")), sw(`${prefix}Sound`, L("Som", "Sound"))];
const ALERT_KEYS = ["start", "notify", "mention", "keyword", "vip", "first", "friendReq"];
// montado na hora para seguir o idioma atual
function settingsPages() {
  return [
    { id: "language", title: L("Idioma", "Language"), icon: "globe", color: "#0a84ff", summary: () => ({ auto: L("Automático", "Automatic"), pt: "Português", en: "English" }[getSettings().language] || L("Automático", "Automatic")),
      sections: [{ footer: L("No automático, o Lurk usa português se o seu Discord estiver em português e inglês em qualquer outro idioma.", "On Automatic, Lurk uses Portuguese when your Discord is in Portuguese and English for any other language."),
        items: [{ id: "language", label: L("Idioma do Lurk", "Lurk language"), type: "select", options: [["auto", L("Automático", "Automatic")], ["pt", "Português (Brasil)"], ["en", "English"]] }] }] },
    { id: "alerts", title: L("Avisos", "Notifications"), icon: "bell", color: "#ff453a",
      summary: () => { const s = getSettings(); const n = ALERT_KEYS.flatMap((p) => ["Toast", "Desktop", "Sound"].map((c) => `${p}${c}`)).filter((x) => s[x] && (s.toastsEnabled || !x.endsWith("Toast"))).length; return n ? L(`${n} ligados`, `${n} on`) : L("Só registra", "Log only"); },
      sections: [
        { title: L("Geral", "General"), footer: L("Desligado: o Lurk não mostra nenhum aviso dentro do Discord (toast), nem confirmações. Notificações do Windows e sons continuam seguindo as opções abaixo.", "Off: Lurk shows no in-app notifications (toasts) at all, not even confirmations. Desktop notifications and sounds still follow the options below."), items: [sw("toastsEnabled", L("Avisos dentro do Discord", "In-app notifications"))] },
        { title: L("Começou a digitar pra você", "Started typing to you"), footer: L("Avisa no instante em que alguém começa a digitar.", "Fires the moment someone starts typing."), items: channelsRows("start") },
        { title: NAMES.typing(), items: [...channelsRows("notify"), sw("notifyEachAttempt", L("Avisar a cada tentativa", "Notify on every attempt"), L("Desligado: só na primeira vez.", "Off: only the first time."))] },
        { title: L("Ghost ping, resposta apagada e reação", "Ghost ping, deleted reply and reaction"), items: channelsRows("mention") },
        { title: L("Palavras-chave", "Keywords"), items: channelsRows("keyword") },
        { title: NAMES.vip(), footer: L("Quais eventos avisam é escolhido no perfil de cada VIP.", "Which events notify you is set on each VIP's profile."), items: channelsRows("vip") },
        { title: L("Digitou pela 1ª vez", "First-time typer"), items: channelsRows("first") },
        { title: L("Pedido de amizade cancelado", "Canceled friend request"), items: channelsRows("friendReq") },
      ] },
    { id: "sound", title: L("Som", "Sound"), icon: "speaker", color: "#ff375f", summary: () => ({ beep: L("Bip", "Beep"), discord: L("Som do Discord", "Discord sound"), custom: L("Arquivo", "File") }[getSettings().soundSource] || L("Bip", "Beep")),
      sections: [{ items: [
        { id: "soundSource", label: L("Fonte", "Source"), type: "select", options: [["beep", L("Bip", "Beep")], ["discord", L("Som do Discord", "Discord sound")], ["custom", L("Arquivo meu", "My own file")]] },
        { id: "discordSound", label: L("Som do Discord", "Discord sound"), type: "select", options: () => DISCORD_SOUNDS.map((x) => [x, x]) },
        num("soundVolume", L("Volume", "Volume"), 0, 100, 5, "%")] }],
      custom: () => h(SoundExtras) },
    { id: "focus", title: L("Modo foco", "Focus mode"), icon: "moon", color: "#5856d6", summary: () => (getSettings().focusMode ? L("Ligado", "On") : L("Desligado", "Off")),
      sections: [{ footer: L("Silencia os avisos do Lurk nessas situações. Tudo continua sendo registrado.", "Silences Lurk notifications in these situations. Everything is still logged."),
        items: [sw("focusMode", L("Modo foco", "Focus mode")), sw("focusOnDnd", L("Quando eu estiver em Não perturbar", "When I'm on Do Not Disturb")), sw("focusWhilePlaying", L("Quando eu estiver jogando", "When I'm playing a game"))] }] },
    { id: "privado", title: NAMES.typing(), icon: "keyboard", color: "#0a84ff",
      sections: [
        { title: L("Monitorar", "Track"), items: [
          sw("trackGroupDMs", L("DMs em grupo", "Group DMs")),
          sw("trackUnknownChannels", L("DMs ocultas", "Hidden DMs"), L("DMs que você fechou ou que nunca abriu, incluindo quem não é seu amigo.", "DMs you closed or never opened, including people who aren't your friends.")),
          sw("recordPresence", L("Registrar status da pessoa", "Log the person's status"), L("Online, ausente, invisível e o dispositivo. Invisível só é confirmado para amigos.", "Online, idle, invisible and the device. Invisible can only be confirmed for friends."))] },
        { title: L("Registro", "Logging"), footer: L("O Discord só manda o sinal de digitação a cada ~10 s, então as durações são aproximadas.", "Discord only sends the typing signal every ~10 s, so durations are approximate."), items: [
          num("mergeWindow", L("Juntar tentativas em até", "Merge attempts within"), 0, 3600, 5, "s"),
          num("minDuration", L("Ignorar digitação menor que", "Ignore typing shorter than"), 0, 600, 1, "s"),
          num("sentLaterWindow", L("Marcar \"enviou depois\" em até", "Mark \"sent later\" within"), 0, 1440, 1, "min"),
          num("maxEntries", L("Guardar no máximo", "Keep at most"), 50, 20000, 50, L("registros", "records"))] },
      ] },
    { id: "mentions", title: NAMES.mentions(), icon: "at", color: "#ff9f0a",
      sections: [
        { items: [
          sw("mentionGhost", "Ghost ping", L("Te marcam e apagam, ou tiram a menção editando.", "Someone pings you and deletes it, or edits the mention out.")),
          sw("mentionReply", L("Resposta apagada", "Deleted reply")),
          sw("mentionReaction", L("Reação removida", "Removed reaction"), L("Só em mensagens que seu Discord já carregou.", "Only on messages your Discord has already loaded."))] },
        { title: L("Palavras-chave", "Keywords"), footer: L("Separe por vírgula. Ignora maiúsculas e acentos e só casa a palavra inteira (\"rank\" não pega \"ranked\").", "Separate with commas. Case- and accent-insensitive, whole words only (\"rank\" won't match \"ranked\")."), items: [
          { id: "keywords", label: L("Palavras", "Words"), type: "text", placeholder: L("sorteio, rank, live", "giveaway, rank, live") },
          sw("keywordIgnoreMuted", L("Ignorar servidores silenciados", "Ignore muted servers"))] },
      ] },
    { id: "contatos", title: NAMES.contacts(), icon: "userPlus", color: "#30d158",
      sections: [{ items: [
        sw("firstContactTrack", L("Digitou pela 1ª vez", "First-time typers"), L("Alguém que nunca falou com você digitou e parou sem enviar. Quem envia a mensagem não entra (evita bots).", "Someone who never talked to you typed and stopped without sending. People who do send aren't listed (keeps bots out).")),
        { ...sw("friendReqTrack", L("Pedidos de amizade cancelados", "Canceled friend requests"), L("Quem te manda pedido e retira. Suas recusas não entram.", "Someone sends you a request and takes it back. Requests you decline aren't listed.")), after: (v) => v && initPendingReqs() }] }] },
    { id: "vip", title: NAMES.vip(), icon: "star", color: "#ffcc00", summary: () => L(`${Object.keys(getVipList()).length} pessoas`, `${Object.keys(getVipList()).length} people`),
      sections: [
        { title: L("Servidores", "Servers"), items: [
          sw("vipTrackServers", L("Digitou e apagou nos servidores", "Typed & quit in servers")),
          { ...sw("vipSubscribeTyping", L("Acompanhar todos os servidores em comum", "Watch all shared servers"), L("Experimental. Sem isto o Discord só avisa digitação dos servidores que você abriu.", "Experimental. Without it, Discord only reports typing in servers you've opened.")), after: (v) => v && scheduleSubscribe() },
          sw("vipRecordMessages", L("Registrar mensagens", "Log messages"), L("Texto e anexos, incluindo editadas e apagadas.", "Text and attachments, including edits and deletions.")),
          sw("vipRecordDMs", L("Incluir mensagens no privado", "Include DMs"))] },
        { title: "Calls", items: [sw("vipTrackVoice", L("Registrar calls dos VIPs", "Log VIP calls"), L("Canal, quem estava, quanto tempo, mute e transmissão.", "Channel, who was there, how long, mute and screen share."))] },
        { title: L("Armazenamento", "Storage"), footer: L("Links de anexos do Discord expiram depois de um tempo.", "Discord attachment links expire after a while."), items: [num("vipMaxMessages", L("Guardar no máximo", "Keep at most"), 100, 50000, 100, L("mensagens", "messages"))] },
      ], custom: () => h(VipAddById, null) },
    { id: "calls", title: L("Calls e apagadas", "Calls & deleted"), icon: "headset", color: "#bf5af2",
      sections: [
        { title: NAMES.calls(), items: [sw("trackMyCalls", L("Contar tempo em call com cada pessoa", "Track call time with each person"))] },
        { title: NAMES.snipe(), footer: L("Mostra o que as pessoas da Lista VIP apagam ou editam, no privado e nos servidores. Usa o registro de mensagens da Lista VIP.", "Shows what people on your VIP list delete or edit, in DMs and servers. Uses the VIP list's message logging."), items: [{ ...sw("showSnipeButton", L("Botão de histórico no topo", "History button in the top bar")), after: () => syncDOM() }] },
      ] },
    { id: "barra", title: L("Barra de servidores", "Server sidebar"), icon: "sidebar", color: "#5e5ce6",
      sections: [{ footer: L("A foto de quem está digitando aparece no topo das DMs, abaixo do botão do Discord, com o indicador por cima.", "The typer's avatar shows at the top of your DMs, below the Discord button, with the typing indicator on top."), items: [
        { ...sw("showGuildBarAvatar", L("Mostrar quem está digitando", "Show who's typing")), after: () => syncDOM() },
        sw("hideWhenChannelOpen", L("Esconder se a DM já estiver aberta", "Hide if the DM is already open")),
        { id: "spinnerType", label: L("Indicador", "Indicator"), type: "select", options: () => SPINNER_TYPES.map((t) => [t, t]) }] }] },
    { id: "button", title: L("Botões e contador", "Buttons & badge"), icon: "button", color: "#636366",
      sections: [{ items: [
        { ...sw("showToolbarButton", L("Botão do Lurk no topo", "Lurk button in the top bar")), after: () => syncDOM() },
        { ...sw("showBadge", L("Contador de novidades", "Unread badge")), after: () => updateBadge() },
        { ...sw("showSnipeButton", L("Botão de histórico (apagadas e editadas)", "History button (deleted & edited)")), after: () => syncDOM() },
        { id: "lurkIcon", label: L("Ícone do Lurk", "Lurk icon"), type: "select", options: [["ghost", L("Fantasminha", "Ghost")], ["ninja", L("Máscara ninja", "Ninja mask")], ["eye", L("Olho", "Eye")]], after: () => syncDOM() }] }] },
    { id: "ignored", title: L("Ignorados", "Ignored"), icon: "ban", color: "#8e8e93", summary: () => { const ig = getIgnored(); const n = Object.keys(ig.users).length + Object.keys(ig.channels).length; return n ? String(n) : L("Nenhum", "None"); }, sections: [], custom: () => h(IgnoredList) },
    { id: "updates", title: L("Atualizações", "Updates"), icon: "refresh", color: "#34c759", summary: () => VERSION,
      sections: [
        { title: L("Depois de atualizar", "After updating"), footer: L("O Lurk procura e instala versões novas sozinho ao abrir o Discord e a cada 6 horas, para que correções cheguem a todo mundo.", "Lurk finds and installs new versions on its own when Discord starts and every 6 hours, so fixes reach everyone."), items: [{ id: "changelogMode", label: L("Novidades da versão", "What's new"), type: "select", options: [["ask", L("Perguntar se quero ver", "Ask me")], ["always", L("Mostrar sempre", "Always show")], ["never", L("Não mostrar", "Don't show")]] }] },
      ], custom: () => h(UpdateSection) },
    { id: "backup", title: "Backup", icon: "archive", color: "#32ade6", summary: () => { const b = getBackups()[0]; return b ? relTime(b.at) : L("Nenhum", "None"); },
      sections: [{ items: [sw("backupEnabled", L("Backup automático", "Automatic backup")), num("backupDays", L("A cada", "Every"), 1, 60, 1, L("dias", "days")), num("backupKeep", L("Guardar", "Keep"), 1, 10, 1, L("cópias", "copies"))] }], custom: () => h(BackupSection) },
  ];
}
const SETTINGS_GROUPS = [["language", "alerts", "sound", "focus"], ["privado", "mentions", "contatos", "vip", "calls"], ["barra", "button", "ignored", "backup", "updates"]];

function SettingsScreen() {
  useBus(settingsBus, vipBus, backupBus, historyBus);
  const nav = useNav();
  const [q, setQ] = React.useState("");
  const pages = settingsPages();
  const query = normalize(q.trim());
  let results = null;
  if (query) {
    results = [];
    for (const page of pages) {
      if (normalize(page.title).includes(query)) results.push({ page, item: null });
      for (const sec of page.sections) for (const item of sec.items) {
        if (normalize(`${txt(item.label)} ${txt(item.note) || ""} ${sec.title || ""}`).includes(query)) results.push({ page, sec, item });
      }
    }
  }
  return h(React.Fragment, null,
    h(LargeTitle, { title: NAMES.settings() }),
    h(Search, { value: q, onChange: setQ, placeholder: L("Buscar ajuste", "Search settings") }),
    results
      ? (results.length
        ? h(Group, { header: L(`${results.length} ${plural(results.length, "resultado", "resultados")}`, `${results.length} ${plural(results.length, "result", "results")}`) }, results.map(({ page, sec, item }, i) => item
            ? h("div", { key: i, className: "dmtt-search-hit" }, h("div", { className: "dmtt-crumb" }, [page.title, sec?.title].filter(Boolean).join(" › ")), h(SettingRow, { item }))
            : h(NavRow, { key: i, icon: page.icon, color: page.color, title: page.title, onClick: () => nav.push({ type: "settingsPage", id: page.id }) })))
        : h(Empty, { icon: "search", title: L("Nenhum ajuste encontrado", "No settings found") }))
      : SETTINGS_GROUPS.map((ids, gi) => h(Group, { key: gi }, ids.map((id) => {
          const page = pages.find((p) => p.id === id);
          return h(NavRow, { key: id, icon: page.icon, color: page.color, title: page.title, detail: page.summary?.() || null, onClick: () => nav.push({ type: "settingsPage", id }) });
        }))),
    !results ? h("div", { className: "dmtt-version" }, `Lurk ${VERSION}`) : null);
}
function SettingsPageScreen({ id }) {
  useBus(settingsBus);
  const page = settingsPages().find((p) => p.id === id);
  if (!page) return null;
  return h(React.Fragment, null,
    h(LargeTitle, { title: page.title }),
    page.sections.map((sec, i) => h(Group, { key: i, header: sec.title, footer: sec.footer }, sec.items.map((item) => h(SettingRow, { key: item.id + i, item })))),
    page.custom ? page.custom() : null);
}

function SoundExtras() {
  useBus(settingsBus);
  const [file, setFile] = React.useState(() => getCustomSound());
  const inputRef = React.useRef(null);
  const pick = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { toast(L("Arquivo muito grande (máx. 2 MB).", "File too large (max 2 MB)."), { type: "error" }); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const data = { name: f.name, data: reader.result };
      RawData.save(SOUND_FILE, "file", data);
      setFile(data);
      if (getSettings().soundSource !== "custom") setSetting("soundSource", "custom");
      toast(L(`Som "${f.name}" salvo`, `Sound "${f.name}" saved`), { type: "success" });
    };
    reader.readAsDataURL(f);
  };
  return h(React.Fragment, null,
    h(Group, { header: L("Arquivo de áudio", "Audio file"), footer: L("MP3, WAV ou OGG de até 2 MB.", "MP3, WAV or OGG up to 2 MB.") },
      h(NavRow, { title: file ? file.name : L("Escolher arquivo…", "Choose file…"), detail: file ? L("Trocar", "Change") : null, onClick: () => inputRef.current?.click() }),
      file ? h(NavRow, { title: L("Remover arquivo", "Remove file"), danger: true, onClick: () => { try { RawData.delete(SOUND_FILE, "file"); } catch {} setFile(null); } }) : null),
    h("input", { ref: inputRef, type: "file", accept: "audio/*", style: { display: "none" }, onChange: pick }),
    h("div", { className: "dmtt-center" }, h("button", { className: "dmtt-btn-primary", onClick: playSound }, h(SIcon, { d: SI.speaker, size: 15 }), L("Testar som", "Test sound"))));
}
function UpdateSection() {
  const [, force] = React.useState(0);
  React.useEffect(() => updateBus.sub(() => force((n) => n + 1)), []);
  const status = updater.checking ? L("Procurando…", "Checking…")
    : updater.error ? L("Erro ao procurar", "Check failed")
    : updater.latest && cmpVer(updater.latest, VERSION) > 0 ? L(`Instalando ${updater.latest}`, `Installing ${updater.latest}`)
    : updater.lastCheck ? L("Em dia", "Up to date") : "";
  return h(React.Fragment, null,
    h(Group, { footer: updater.lastCheck ? L(`Última busca: ${relTime(updater.lastCheck)}`, `Last checked: ${relTime(updater.lastCheck)}`) : null },
      h(NavRow, { title: L(`Versão instalada: ${VERSION}`, `Installed version: ${VERSION}`), detail: status }),
      h(NavRow, { title: L("Procurar atualização agora", "Check for updates now"), onClick: () => checkForUpdate(true) }),
      h(NavRow, { title: L("Ver novidades desta versão", "See what's new in this version"), onClick: () => showChangelog(CHANGELOG[1]?.version || null) }),
      h(NavRow, { title: L("Página do Lurk no GitHub", "Lurk on GitHub"), onClick: () => window.open(`https://github.com/${REPO}`, "_blank") })));
}
function BackupSection() {
  useBus(backupBus);
  const inputRef = React.useRef(null);
  const list = getBackups();
  const size = (b) => { const n = JSON.stringify(b).length; return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`; };
  const confirmRestore = (b, origin) => confirmDanger(L("Restaurar backup", "Restore backup"),
    L(`Restaurar o backup de ${fmtDate(b.at).slice(0, 16)}${origin ? ` (${origin})` : ""}? Os dados atuais serão substituídos; antes disso o Lurk guarda uma cópia do estado atual.`, `Restore the backup from ${fmtDate(b.at).slice(0, 16)}${origin ? ` (${origin})` : ""}? Your current data will be replaced; Lurk saves a copy of it first.`),
    () => { try { restoreBackup(b); toast(L("Backup restaurado", "Backup restored"), { type: "success" }); } catch (e) { toast(String(e.message || e), { type: "error" }); } }, L("Restaurar", "Restore"));
  const pick = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { try { confirmRestore(JSON.parse(r.result), f.name); } catch { toast(L("Arquivo inválido.", "Invalid file."), { type: "error" }); } };
    r.readAsText(f);
  };
  return h(React.Fragment, null,
    h(Group, { header: L("Cópias guardadas", "Saved copies"), footer: list.length ? null : L("Nenhum backup ainda.", "No backups yet.") },
      list.map((b) => h(NavRow, { key: b.at, title: fmtDate(b.at).slice(0, 16), subtitle: L(`${size(b)} · ${(b.data?.history || []).length} registros · ${(b.data?.mentions || []).length} menções`, `${size(b)} · ${(b.data?.history || []).length} records · ${(b.data?.mentions || []).length} mentions`), detail: L("Restaurar", "Restore"), onClick: () => confirmRestore(b) }))),
    h(Group, null,
      h(NavRow, { title: L("Fazer backup agora", "Back up now"), onClick: () => { runBackup(true); toast(L("Backup feito", "Backup done"), { type: "success" }); } }),
      h(NavRow, { title: L("Exportar arquivo…", "Export file…"), onClick: () => saveFile(`Lurk-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(collectBackup()), "application/json") }),
      h(NavRow, { title: L("Importar arquivo…", "Import file…"), onClick: () => inputRef.current?.click() })),
    h("input", { ref: inputRef, type: "file", accept: ".json,application/json", style: { display: "none" }, onChange: pick }));
}
function IgnoredList() {
  useBus(historyBus);
  const ig = getIgnored();
  const entries = [
    ...Object.entries(ig.users).map(([id, x]) => ({ type: "users", id, label: nameOf(id, { label: x.label }), sub: usernameOf(id) ? `@${usernameOf(id)}` : L("Pessoa", "Person") })),
    ...Object.entries(ig.channels).map(([id, x]) => ({ type: "channels", id, label: channelLabel(ChannelStore?.getChannel?.(id)) || x.label, sub: L("Grupo", "Group") })),
  ];
  return entries.length
    ? h(Group, { footer: L("Pessoas e grupos ignorados não são monitorados.", "Ignored people and groups aren't tracked.") }, entries.map((e) => h("div", { key: e.type + e.id, className: "dmtt-row" },
        e.type === "users" ? h(Avatar, { userId: e.id, size: 30 }) : h(IconTile, { name: "userPlus", color: "#8e8e93", size: 30 }),
        h("span", { className: "dmtt-row-main" }, h("span", { className: "dmtt-row-title" }, e.label), h("span", { className: "dmtt-row-sub" }, e.sub)),
        h("button", { className: "dmtt-link", onClick: () => toggleIgnore(e.type, e.id) }, L("Remover", "Remove")))))
    : h(Empty, { icon: "ban", title: L("Ninguém ignorado", "No one ignored") }, L("Clique com o botão direito em uma pessoa ou grupo para ignorar.", "Right-click a person or group to ignore them."));
}

/* ================================================================== */
/* Abrir o painel                                                       */
/* ================================================================== */
function openApp(stack) {
  lastSeenBeforeOpen = getSeenAt();
  markSeen();
  UI.showConfirmationModal("", h(App, { initial: stack }), { confirmText: L("Fechar", "Close"), cancelText: null });
}
const openHub = () => openApp([{ type: "home" }]);
function openHistory(filter = {}) {
  if (filter.userId) openApp([{ type: "home" }, { type: "typing" }, { type: "person", userId: filter.userId }]);
  else openApp([{ type: "home" }, { type: "typing", channelId: filter.channelId }]);
}
const openVip = (id) => openApp([{ type: "home" }, { type: "vip" }, { type: "vipPerson", userId: id }]);
const openSnipe = (channelId) => openApp([{ type: "home" }, { type: "snipe", channelId }]);

/* ================================================================== */
/* Botões no topo (ao lado do RemovedConnectionAlerts)                  */
/* ================================================================== */
let toolbarBtn = null;
let snipeBtn = null;
let toolbarLang = null;
function makeTopButton(label, iconHTML, onClick) {
  const btn = document.createElement("div");
  btn.className = `dmtt-toolbar-btn ${upperContainerModule ? `${upperContainerModule.iconWrapper} ${upperContainerModule.clickable}` : ""}`;
  btn.setAttribute("role", "button");
  btn.setAttribute("tabindex", "0");
  btn.setAttribute("aria-label", label);
  btn.innerHTML = `${iconHTML}<span class="dmtt-toolbar-badge" hidden></span>`;
  btn.addEventListener("click", onClick);
  try { UI.createTooltip(btn, label, { side: "bottom" }); } catch {}
  return btn;
}
const svgStroke = (d) => `<svg class="dmtt-toolbar-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
function placeToolbarButton() {
  const s = getSettings();
  // botões recriados se o idioma mudar (tooltip)
  // botões recriados se o idioma ou o ícone mudar
  const key = `${lang()}|${s.lurkIcon}`;
  if (toolbarLang && toolbarLang !== key) { toolbarBtn?.remove(); snipeBtn?.remove(); toolbarBtn = null; snipeBtn = null; }
  toolbarLang = key;
  if (!s.showToolbarButton) { toolbarBtn?.remove(); }
  else {
    if (!toolbarBtn) { toolbarBtn = makeTopButton("Lurk", svgStroke(LURK_ICON()), () => openHub()); updateBadge(); }
    const rca = document.querySelector('[aria-label="Removed Connection History"]');
    if (rca?.parentElement) {
      if (rca.nextElementSibling !== toolbarBtn) rca.insertAdjacentElement("afterend", toolbarBtn);
      diag.toolbar = "next to RemovedConnectionAlerts";
    } else if (!toolbarBtn.isConnected) {
      const inbox = document.querySelector('[aria-label="Inbox"], [aria-label="Caixa de entrada"]');
      const upperCls = upperContainerModule?.upperContainer?.split(" ")[0];
      const upper = upperCls && document.querySelector(`.${upperCls}`);
      if (inbox?.parentElement) { inbox.parentElement.insertBefore(toolbarBtn, inbox); diag.toolbar = "before inbox"; }
      else if (upper?.lastElementChild) { upper.lastElementChild.insertAdjacentElement("afterbegin", toolbarBtn); diag.toolbar = "upperContainer"; }
    }
  }
  if (!s.showSnipeButton) { snipeBtn?.remove(); return; }
  if (!snipeBtn) { snipeBtn = makeTopButton(NAMES.snipe(), svgStroke(SI.clock), () => openSnipe(SelectedChannelStore?.getChannelId?.() || null)); updateSnipeBadge(); }
  const anchor = toolbarBtn?.isConnected ? toolbarBtn : document.querySelector('[aria-label="Removed Connection History"]');
  if (anchor?.parentElement && anchor.nextElementSibling !== snipeBtn) anchor.insertAdjacentElement("afterend", snipeBtn);
}
function updateBadge() {
  const badge = toolbarBtn?.querySelector(".dmtt-toolbar-badge");
  if (!badge) return;
  const seen = getSeenAt();
  const n = getSettings().showBadge
    ? new Set(getHistory().filter((r) => r.lastTypingAt > seen).map((r) => r.userId)).size
      + getCanceledReqs().filter((r) => (r.canceledAt || 0) > seen).length
      + getFirstContacts().filter((e) => e.at > seen).length
      + (mentionData.owner ? mentionData.events.filter((e) => e.at > seen).length : 0)
    : 0;
  badge.hidden = !n;
  badge.textContent = n > 99 ? "99+" : String(n);
}
function updateSnipeBadge() {
  const badge = snipeBtn?.querySelector(".dmtt-toolbar-badge");
  if (!badge) return;
  const n = getSettings().showBadge ? newChangesCount() : 0;
  badge.hidden = !n;
  badge.textContent = n > 99 ? "99+" : String(n);
}

/* ================================================================== */
/* Observador único do DOM                                               */
/* ================================================================== */
let domObserver = null;
let domRaf = 0;
function syncDOM() {
  try { placeToolbarButton(); } catch (e) { Logger.error("toolbar", e); }
  try { placeGuildBar(); } catch (e) { Logger.error("guildbar", e); }
}
function startDOM() {
  stopDOM();
  syncDOM();
  domObserver = new MutationObserver(() => {
    if (domRaf) return;
    domRaf = requestAnimationFrame(() => { domRaf = 0; syncDOM(); });
  });
  domObserver.observe(document.body, { childList: true, subtree: true });
}
function stopDOM() {
  domObserver?.disconnect();
  domObserver = null;
  if (domRaf) cancelAnimationFrame(domRaf);
  domRaf = 0;
  toolbarBtn?.remove(); toolbarBtn = null;
  snipeBtn?.remove(); snipeBtn = null;
  unmountGuildBar();
}

/* ================================================================== */
/* Estilos                                                              */
/* ================================================================== */
const CSS = `
/* barra de servidores */
.dmtt-guildbar { display: flex; flex-direction: column; gap: var(--space-xs, 8px); width: 100%; }
.dmtt-guildbar.dmtt-empty-bar { display: none; }
.dmtt-li { position: relative; display: flex; justify-content: center; width: 100%; }
.dmtt-item { position: relative; width: var(--dmtt-size, 40px); height: var(--dmtt-size, 40px); cursor: pointer; animation: dmtt-in .18s ease-out; }
.dmtt-avatar { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block; transition: border-radius .15s ease; }
.dmtt-item:hover .dmtt-avatar, .dmtt-item:hover .dmtt-overlay { border-radius: 30%; }
.dmtt-overlay { position: absolute; inset: 0; border-radius: 50%; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; color: #fff; pointer-events: none; transition: border-radius .15s ease; overflow: hidden; }
.dmtt-overlay > * { color: #fff; transform: scale(.85); }
.dmtt-pill { position: absolute; left: 0; top: 50%; width: 4px; height: 8px; margin-top: -4px; border-radius: 0 4px 4px 0; background: var(--header-primary, var(--text-strong, #fff)); transition: height .15s, margin-top .15s; }
.dmtt-li:hover .dmtt-pill { height: 20px; margin-top: -10px; }
@keyframes dmtt-in { from { transform: scale(.6); opacity: 0; } to { transform: scale(1); opacity: 1; } }

/* botões do topo */
.dmtt-toolbar-btn { position: relative; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--interactive-normal, var(--interactive-icon-default)); }
.dmtt-toolbar-btn:hover { color: var(--interactive-hover, var(--interactive-icon-hover)); }
.dmtt-toolbar-btn { width: 24px; height: 24px; margin: 0 6px; opacity: .85; transition: opacity .12s, color .12s; }
.dmtt-toolbar-btn:hover { opacity: 1; }
.dmtt-toolbar-icon { width: 20px; height: 20px; display: block; }
.dmtt-toolbar-badge { top: -5px !important; right: -7px !important; }
.dmtt-toolbar-badge { position: absolute; top: -4px; right: -6px; min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box; border-radius: 8px; background: #ff3b30; color: #fff; font-size: 11px; font-weight: 700; line-height: 16px; text-align: center; pointer-events: none; }
.dmtt-toolbar-badge[hidden] { display: none; }

/* ---------- app ---------- */
.dmtt-app {
  --c-text: var(--text-default, var(--text-normal, #dbdee1));
  --c-strong: var(--header-primary, var(--text-strong, #f2f3f5));
  --c-muted: var(--text-muted, #949ba4);
  --c-fill: var(--background-secondary, var(--background-base-lower, #2b2d31));
  --c-fill2: var(--background-tertiary, var(--background-base-lowest, #1e1f22));
  --c-hover: var(--background-modifier-hover, rgba(255,255,255,.05));
  --c-sep: var(--border-subtle, rgba(255,255,255,.07));
  --c-link: var(--text-link, #00a8fc);
  --c-red: #ff453a; --c-green: #30d158;
  display: flex; flex-direction: column; height: min(620px, 70vh); color: var(--c-text); font-size: 14px; line-height: 1.35;
  -webkit-font-smoothing: antialiased;
}
.dmtt-app button { font-family: inherit; }
.dmtt-navbar { display: flex; align-items: center; gap: 8px; height: 36px; flex: none; border-bottom: 1px solid var(--c-sep); padding: 0 2px 6px; }
.dmtt-navbar-spacer { flex: 1; }
.dmtt-brand { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--c-muted); }
.dmtt-back { display: inline-flex; align-items: center; gap: 0; margin-left: -6px; padding: 4px 8px 4px 2px; border: none; border-radius: 8px; background: none; color: var(--c-link); font-size: 15px; cursor: pointer; max-width: 70%; }
.dmtt-back span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dmtt-back:hover, .dmtt-nav-icon:hover { background: var(--c-hover); }
.dmtt-nav-icon { display: inline-flex; padding: 6px; border: none; border-radius: 8px; background: none; color: var(--c-link); cursor: pointer; }
.dmtt-body { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 0 4px 20px 2px; margin-right: -6px; display: flex; flex-direction: column; gap: 12px; animation: dmtt-push .22s cubic-bezier(.2,.8,.2,1); scrollbar-width: thin; }
@keyframes dmtt-push { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: none; } }
.dmtt-largetitle { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; padding: 14px 4px 0; }
.dmtt-largetitle h1 { margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -.01em; color: var(--c-strong); line-height: 1.15; }
.dmtt-largetitle-sub { margin-top: 3px; font-size: 13px; color: var(--c-muted); }
.dmtt-largetitle-sub::first-letter { text-transform: uppercase; }

.dmtt-search { display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 10px; border-radius: 10px; background: var(--c-fill2); color: var(--c-muted); }
.dmtt-search input { flex: 1; min-width: 0; border: none; outline: none; background: none; color: var(--c-text); font-size: 14px; }
.dmtt-search input::placeholder { color: var(--c-muted); }
.dmtt-search:focus-within { box-shadow: 0 0 0 2px rgba(10,132,255,.6); }
.dmtt-search-x { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border: none; border-radius: 50%; background: var(--c-muted); color: var(--c-fill2); cursor: pointer; padding: 0; }

.dmtt-seg { display: flex; gap: 2px; padding: 2px; border-radius: 9px; background: var(--c-fill2); overflow-x: auto; scrollbar-width: none; flex: none; }
.dmtt-seg::-webkit-scrollbar { display: none; }
.dmtt-seg-btn { flex: 1 0 auto; display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: 28px; padding: 0 10px; border: none; border-radius: 7px; background: transparent; color: var(--c-muted); font-size: 12.5px; font-weight: 500; cursor: pointer; transition: background .15s, color .15s; white-space: nowrap; }
.dmtt-seg-btn:hover { color: var(--c-text); }
.dmtt-seg-btn.is-on { background: var(--background-modifier-selected, rgba(255,255,255,.12)); color: var(--c-strong); box-shadow: 0 1px 3px rgba(0,0,0,.3); font-weight: 600; }
.dmtt-seg-n { font-size: 11px; opacity: .65; font-variant-numeric: tabular-nums; }
.dmtt-row2 { display: flex; flex-wrap: wrap; gap: 8px; }
.dmtt-row2 > .dmtt-seg { flex: 1 1 200px; }

/* listas agrupadas */
.dmtt-sec { display: flex; flex-direction: column; }
.dmtt-sec-h { padding: 4px 14px 6px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .03em; color: var(--c-muted); }
.dmtt-sec-f { padding: 6px 14px 0; font-size: 12px; color: var(--c-muted); line-height: 1.4; }
.dmtt-sec-f-top { padding-top: 0; }
.dmtt-group { border-radius: 12px; background: var(--c-fill); overflow: hidden; }
.dmtt-group > * { position: relative; }
.dmtt-group > * + *::before { content: ""; position: absolute; top: 0; left: 14px; right: 0; height: 1px; background: var(--c-sep); z-index: 1; }
.dmtt-group > * + *:has(.dmtt-tile, .dmtt-av, .dmtt-tl-dot, .dmtt-live-dot)::before { left: 54px; }
.dmtt-row { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 44px; padding: 8px 14px; box-sizing: border-box; border: none; background: transparent; color: inherit; text-align: left; font: inherit; }
button.dmtt-row { cursor: pointer; }
button.dmtt-row:hover, .dmtt-row[style*="pointer"]:hover { background: var(--c-hover); }
button.dmtt-row:active { background: var(--background-modifier-active, rgba(255,255,255,.08)); }
.dmtt-row.is-danger .dmtt-row-title { color: var(--c-red); }
.dmtt-row-col { flex-direction: column; align-items: stretch; gap: 6px; }
.dmtt-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.dmtt-row-title { font-size: 14.5px; font-weight: 500; color: var(--c-strong); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dmtt-row-user { font-weight: 400; font-size: 12.5px; color: var(--c-muted); }
.dmtt-row-sub { font-size: 12.5px; color: var(--c-muted); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.dmtt-row-detail { font-size: 14px; color: var(--c-muted); white-space: nowrap; flex: none; }
.dmtt-row-side { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex: none; }
.dmtt-row-time { font-size: 12px; color: var(--c-muted); font-variant-numeric: tabular-nums; white-space: nowrap; flex: none; }
.dmtt-chev { display: inline-flex; color: var(--c-muted); opacity: .55; flex: none; }
.dmtt-chev-rot { transition: transform .18s; }
.dmtt-cell.is-open > .dmtt-row .dmtt-chev-rot { transform: rotate(90deg); }
.dmtt-tile { display: inline-flex; align-items: center; justify-content: center; border-radius: 7px; color: #fff; flex: none; }
.dmtt-badge-red { min-width: 20px; height: 20px; padding: 0 6px; box-sizing: border-box; border-radius: 10px; background: #ff3b30; color: #fff; font-size: 12px; font-weight: 600; line-height: 20px; text-align: center; flex: none; }
.dmtt-countpill { font-size: 11px; font-weight: 600; padding: 0 6px; border-radius: 8px; line-height: 16px; background: var(--c-fill2); color: var(--c-text); }
.dmtt-strong { color: var(--c-strong); font-weight: 600; }
.dmtt-num { font-variant-numeric: tabular-nums; }
.dmtt-muted { color: var(--c-muted); }
.dmtt-small { font-size: 13px; }
.dmtt-time-lead { margin-right: 8px; }
.dmtt-sep { opacity: .7; }
.dmtt-inline { display: inline; }
.dmtt-devices { display: inline; margin-left: 5px; white-space: nowrap; }
.dmtt-sep + .dmtt-devices { margin-left: 0; }
.dmtt-device { display: inline; opacity: .9; }
.dmtt-device + .dmtt-device { margin-left: 3px; }
.dmtt-device svg { display: inline-block; vertical-align: -2px; }
.dmtt-flag-muted, .dmtt-flag-deafened { color: #ff6961; }
.dmtt-flag-streamed { color: #bf5af2; }
.dmtt-flag-video { color: var(--c-green); }

/* avatar e status */
.dmtt-av { position: relative; flex: none; }
.dmtt-av img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block; }
.dmtt-dot { position: absolute; right: -2px; bottom: -2px; box-sizing: border-box; border-radius: 50%; border: 2.5px solid var(--c-fill); background: #80848e; }
.dmtt-hero .dmtt-dot { border-color: var(--modal-background, var(--background-primary, #313338)); }
.dmtt-dot-online { background: #23a55a !important; }
.dmtt-dot-idle { background: #f0b232 !important; }
.dmtt-dot-dnd { background: #f23f43 !important; }
.dmtt-dot-streaming { background: #593695 !important; }
.dmtt-dot-offline { background: #80848e !important; }
.dmtt-dot-invisible { background: transparent !important; box-shadow: inset 0 0 0 2.5px #80848e; }
.dmtt-dot.dmtt-dot-invisible { background: var(--c-fill) !important; }
.dmtt-tl-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; background: var(--c-muted); margin: 0 6px 0 2px; }
.dmtt-live-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--c-green); flex: none; margin: 0 6px 0 2px; animation: dmtt-pulse 1.6s infinite; }
.dmtt-live-inline { color: var(--c-green); font-weight: 500; }
@keyframes dmtt-pulse { 0% { box-shadow: 0 0 0 0 rgba(48,209,88,.6); } 70% { box-shadow: 0 0 0 7px rgba(48,209,88,0); } 100% { box-shadow: 0 0 0 0 rgba(48,209,88,0); } }

/* controles */
.dmtt-switch { position: relative; width: 44px; height: 26px; flex: none; border: none; border-radius: 13px; background: rgba(120,120,128,.36); cursor: pointer; transition: background .2s; padding: 0; }
.dmtt-switch.is-on { background: var(--c-green); }
.dmtt-switch-knob { position: absolute; top: 2px; left: 2px; width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 2px 4px rgba(0,0,0,.3); transition: transform .2s cubic-bezier(.3,.7,.4,1); }
.dmtt-switch.is-on .dmtt-switch-knob { transform: translateX(18px); }
.dmtt-stepper { display: inline-flex; align-items: center; gap: 4px; flex: none; }
.dmtt-step-btn { width: 28px; height: 28px; border: none; border-radius: 8px; background: var(--c-fill2); color: var(--c-strong); font-size: 17px; line-height: 1; cursor: pointer; }
.dmtt-step-btn:disabled { opacity: .35; cursor: default; }
.dmtt-stepper input { width: 52px; height: 28px; box-sizing: border-box; border: none; border-radius: 8px; background: var(--c-fill2); color: var(--c-strong); text-align: center; font-size: 14px; font-variant-numeric: tabular-nums; outline: none; }
.dmtt-step-unit { font-size: 12px; color: var(--c-muted); min-width: 20px; }
.dmtt-select { max-width: 55%; height: 30px; padding: 0 8px; border: none; border-radius: 8px; background: var(--c-fill2); color: var(--c-strong); font-size: 13.5px; cursor: pointer; outline: none; }
.dmtt-text { width: 100%; box-sizing: border-box; height: 34px; padding: 0 10px; border: none; border-radius: 8px; background: var(--c-fill2); color: var(--c-strong); font-size: 14px; outline: none; }
.dmtt-text:focus, .dmtt-stepper input:focus { box-shadow: 0 0 0 2px rgba(10,132,255,.6); }
.dmtt-search-hit .dmtt-crumb { padding: 8px 14px 0; font-size: 11px; color: var(--c-muted); }
.dmtt-btn-primary { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 16px; border: none; border-radius: 10px; background: #0a84ff; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; }
.dmtt-btn-primary:hover { filter: brightness(1.1); }
.dmtt-center { display: flex; justify-content: center; }
.dmtt-link { align-self: flex-start; border: none; background: none; padding: 2px 4px; margin-left: -4px; border-radius: 6px; color: var(--c-link); font-size: 13px; font-weight: 500; cursor: pointer; flex: none; }
.dmtt-link:hover { background: var(--c-hover); }
.dmtt-row > .dmtt-link { align-self: center; margin-left: 0; }
.dmtt-more { align-self: center; border: none; background: none; color: var(--c-link); font-size: 13px; font-weight: 500; cursor: pointer; padding: 6px 10px; border-radius: 8px; }
.dmtt-more:hover { background: var(--c-hover); }
.dmtt-del { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; flex: none; border: none; border-radius: 50%; background: var(--c-fill2); color: var(--c-muted); cursor: pointer; opacity: 0; transition: opacity .12s; padding: 0; }
.dmtt-row:hover .dmtt-del, .dmtt-card:hover .dmtt-del, .dmtt-cell:hover .dmtt-del { opacity: 1; }
.dmtt-del:hover { background: rgba(255,69,58,.18); color: var(--c-red); }
.dmtt-ok { display: inline-flex; align-items: center; flex: none; font-size: 12px; font-weight: 600; color: var(--c-green); }
.dmtt-tag { font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 6px; background: var(--c-fill2); color: var(--c-text); border: none; white-space: nowrap; flex: none; font-family: inherit; }
.dmtt-tag.is-red { background: rgba(255,69,58,.16); color: #ff6961; }
.dmtt-tag.is-btn { cursor: pointer; }

/* hero e números */
.dmtt-hero { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 16px 0 4px; text-align: center; }
.dmtt-hero-name { margin-top: 8px; font-size: 21px; font-weight: 700; color: var(--c-strong); }
.dmtt-hero-user { font-size: 13px; color: var(--c-muted); }
.dmtt-chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin-top: 8px; }
.dmtt-chip { font-size: 12px; font-weight: 500; padding: 3px 10px; border-radius: 12px; background: var(--c-fill); color: var(--c-text); }
.dmtt-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 14px; }
.dmtt-action { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 76px; padding: 9px 10px 7px; border: none; border-radius: 12px; background: var(--c-fill); color: var(--c-link); font-size: 11.5px; font-weight: 500; cursor: pointer; }
.dmtt-action:hover { background: var(--c-hover); }
.dmtt-action-ico { display: inline-flex; }
.dmtt-action.is-vip { color: #ffcc00; }
.dmtt-action.is-danger { color: var(--c-red); }
.dmtt-action.is-muted { color: var(--c-muted); }
.dmtt-stats { display: grid; border-radius: 12px; background: var(--c-fill); }
.dmtt-stat { display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 10px 4px; min-width: 0; }
.dmtt-stat + .dmtt-stat { border-left: 1px solid var(--c-sep); }
.dmtt-stat b { font-size: 18px; font-weight: 700; color: var(--c-strong); font-variant-numeric: tabular-nums; white-space: nowrap; }
.dmtt-stat span { font-size: 11px; color: var(--c-muted); }
.dmtt-tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.dmtt-tile-card { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 12px 14px; border: none; border-radius: 14px; background: var(--c-fill); color: inherit; text-align: left; cursor: pointer; transition: background .12s, transform .12s; min-width: 0; }
.dmtt-tile-card:hover { background: var(--c-hover); }
.dmtt-tile-card:active { transform: scale(.98); }
.dmtt-tile-dot { width: 8px; height: 8px; border-radius: 50%; margin-bottom: 6px; }
.dmtt-tile-card b { font-size: 26px; font-weight: 700; color: var(--c-strong); font-variant-numeric: tabular-nums; line-height: 1.05; }
.dmtt-tile-card span:last-child { font-size: 12px; color: var(--c-muted); }

/* cartões de mensagem */
.dmtt-card { display: flex; flex-direction: column; gap: 6px; padding: 10px 14px; }
.dmtt-card-head { display: flex; align-items: center; gap: 10px; }
.dmtt-card-action { font-weight: 400; color: var(--c-muted); font-size: 13px; }
.dmtt-bubble { padding: 8px 12px; border-radius: 14px; background: var(--c-fill2); white-space: pre-wrap; word-break: break-word; font-size: 14px; color: var(--c-text); align-self: flex-start; max-width: 100%; box-sizing: border-box; }
.dmtt-bubble.is-deleted { color: #ff6961; }
.dmtt-quote { padding: 4px 10px; border-left: 2px solid var(--c-sep); font-size: 12.5px; color: var(--c-muted); white-space: pre-wrap; word-break: break-word; display: flex; flex-direction: column; gap: 2px; }
.dmtt-quote b { color: var(--c-text); font-weight: 600; }
.dmtt-files { display: flex; flex-wrap: wrap; gap: 8px; font-size: 12.5px; }
.dmtt-files a { color: var(--c-link); }
.dmtt-kw { color: var(--c-strong); background: rgba(255,159,10,.22); padding: 0 5px; border-radius: 5px; font-weight: 600; }
.dmtt-emoji { width: 16px; height: 16px; vertical-align: -3px; }

/* expandíveis */
.dmtt-sub { display: flex; flex-direction: column; gap: 4px; padding: 0 14px 12px 40px; }
.dmtt-subrow { display: flex; gap: 10px; font-size: 12.5px; }
.dmtt-subrow-n { width: 22px; font-weight: 600; }
.dmtt-vdetail { gap: 6px; }
.dmtt-mini-h { margin-top: 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--c-muted); }
.dmtt-vpeer { display: flex; align-items: center; gap: 10px; }
.dmtt-vpeer.is-gone { opacity: .5; }
.dmtt-vt { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
.dmtt-vt > .dmtt-num { width: 56px; flex: none; }
.dmtt-vt-dot { width: 13px; display: inline-flex; justify-content: center; flex: none; }
.dmtt-vt-dot::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: var(--c-muted); }
.dmtt-vt-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; font-size: 12.5px; }
.dmtt-cell.is-live { background: rgba(48,209,88,.07); }
.dmtt-peers { display: inline-flex; align-items: center; flex: none; }
.dmtt-peers img { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--c-fill); margin-left: -7px; object-fit: cover; }
.dmtt-peers img:first-child { margin-left: 0; }
.dmtt-peers-more { font-size: 11px; color: var(--c-muted); margin-left: 4px; }
.dmtt-rank { width: 18px; text-align: center; font-size: 13px; font-weight: 600; color: var(--c-muted); flex: none; font-variant-numeric: tabular-nums; }
.dmtt-bar { display: block; height: 4px; border-radius: 2px; background: var(--c-fill2); margin: 4px 0 2px; overflow: hidden; }
.dmtt-bar > span { display: block; height: 100%; border-radius: 2px; background: #bf5af2; }

.dmtt-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 36px 20px; text-align: center; color: var(--c-muted); font-size: 13px; line-height: 1.45; }
.dmtt-empty-ico { display: flex; align-items: center; justify-content: center; width: 56px; height: 56px; border-radius: 50%; background: var(--c-fill); color: var(--c-muted); margin-bottom: 4px; }
.dmtt-empty-title { font-size: 16px; font-weight: 600; color: var(--c-strong); }
.dmtt-addid { gap: 8px; }
.dmtt-addid .dmtt-text { flex: 1; }
.dmtt-addid .dmtt-btn-primary { height: 34px; flex: none; }
.dmtt-btn-primary:disabled { opacity: .45; cursor: default; filter: none; }
.dmtt-addid-msg { font-size: 13px; min-height: 0; padding-top: 0; }
.dmtt-addid-msg.is-ok { color: var(--c-green); }
.dmtt-addid-msg.is-err { color: #ff6961; }
.dmtt-select-wide { max-width: 100%; width: 100%; height: 34px; }
.dmtt-newdot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #0a84ff; margin-right: 6px; vertical-align: 2px; }
.dmtt-avbtn { padding: 0; border: none; background: none; cursor: pointer; border-radius: 50%; flex: none; }
.dmtt-app { overscroll-behavior: contain; }
.dmtt-body::-webkit-scrollbar { width: 8px; }
.dmtt-body::-webkit-scrollbar-thumb { background: var(--scrollbar-thin-thumb, rgba(255,255,255,.18)); border-radius: 4px; }
.dmtt-body::-webkit-scrollbar-track { background: transparent; }
.dmtt-version { text-align: center; font-size: 11px; color: var(--c-muted); padding: 8px 0 4px; }
`;

/* ================================================================== */
/* Plugin                                                               */
/* ================================================================== */
const SUBS = {
  TYPING_START: onTypingStart,
  MESSAGE_CREATE: onMessageCreate,
  MESSAGE_UPDATE: onMessageUpdate,
  MESSAGE_DELETE: onMessageDelete,
  MESSAGE_DELETE_BULK: onMessageDeleteBulk,
  RELATIONSHIP_ADD: onRelationshipAdd,
  RELATIONSHIP_REMOVE: onRelationshipRemove,
  MESSAGE_REACTION_ADD: onReactionAdd,
  MESSAGE_REACTION_REMOVE: onReactionRemove,
  VOICE_STATE_UPDATES: onVoiceStates,
  CONNECTION_OPEN: () => setTimeout(subscribeVipGuilds, 3000),
};

module.exports = class Lurk {
  start() {
    settingsCache = null;
    historyCache = null;
    vipData.owner = null;
    mentionData.owner = null;
    callData.owner = null;
    gb.logged = false;
    DOM.addStyle(PLUGIN, CSS);
    if (!Dispatcher) {
      toast(L("Lurk: não encontrei o Dispatcher do Discord.", "Lurk: couldn't find Discord's Dispatcher."), { type: "error" });
      return;
    }
    // dados da versão antiga (DMTypingTracker) são copiados uma vez
    if (safe(() => migrateLegacy())) { settingsCache = null; toast(L("Lurk: seus dados do DMTypingTracker foram importados.", "Lurk: your DMTypingTracker data was imported."), { type: "success" }); }
    for (const [ev, fn] of Object.entries(SUBS)) Dispatcher.subscribe(ev, fn);
    // interceptor do snipe: registrado uma vez só; o hook aponta pra instância atual
    window.__dmttSnipeHook = snipeInterceptor;
    snipeActive = true;
    if (!window.__dmttInterceptorAdded && typeof Dispatcher.addInterceptor === "function") {
      Dispatcher.addInterceptor((a) => { try { return window.__dmttSnipeHook?.(a) || false; } catch { return false; } });
      window.__dmttInterceptorAdded = true;
    }
    getHistory();
    loadVip();
    loadMentions();
    loadCalls();
    initPresenceCache();
    safe(() => initVoice());
    safe(() => initMyCall());
    safe(() => initKnownContacts());
    PresenceStore?.addChangeListener?.(onPresenceChange);
    this.onChannelSelect = () => {};
    SelectedChannelStore?.addChangeListener?.(this.onChannelSelect);
    this.onSettings = settingsBus.sub(() => safe(() => syncDOM()));
    scheduleSubscribe();
    this.subInterval = setInterval(subscribeVipGuilds, 120000);
    this.backupTimer = setTimeout(() => safe(() => runBackup(false)), 30000);
    this.backupInterval = setInterval(() => safe(() => runBackup(false)), 6 * 3600000);
    safe(() => initPendingReqs());
    patchRelationshipActions();
    this.patchContextMenus();
    startDOM();
    safe(() => afterUpdateCheck());
    this.updateTimer = setTimeout(() => checkForUpdate(false), 20000);
    this.updateInterval = setInterval(() => checkForUpdate(false), 6 * 3600000);
  }

  patchContextMenus() {
    this.unpatchers = [];
    this.unpatchers.push(ContextMenu.patch("user-context", (ret, props) => {
      const id = props?.user?.id;
      if (!id || id === myId()) return;
      const attempts = getHistory().filter((r) => r.userId === id).reduce((n, r) => n + attemptsOf(r).length, 0);
      const vip = isVip(id);
      const label = props.user.globalName || props.user.username;
      const call = callTotals().find((t) => t.id === id);
      pushItems(ret, [
        ContextMenu.buildItem({ type: "separator" }),
        ContextMenu.buildItem({ label: `${NAMES.typing()}${attempts ? ` (${attempts})` : ""}`, action: () => openHistory({ userId: id }) }),
        vip ? ContextMenu.buildItem({ label: L("Ver na Lista VIP", "Open in VIP list"), action: () => openVip(id) }) : null,
        call ? ContextMenu.buildItem({ label: L(`Tempo em call juntos: ${fmtDur(call.ms)}`, `Call time together: ${fmtDur(call.ms)}`), action: () => openApp([{ type: "home" }, { type: "calls" }, { type: "callPerson", userId: id }]) }) : null,
        ContextMenu.buildItem({ type: "toggle", label: NAMES.vip(), checked: vip, action: () => toggleVip(id, label) }),
        ContextMenu.buildItem({ type: "toggle", label: L("Ignorar no Lurk", "Ignore in Lurk"), checked: isIgnoredUser(id), action: () => toggleIgnore("users", id, props.user.username) }),
      ].filter(Boolean));
    }));
    this.unpatchers.push(ContextMenu.patch("gdm-context", (ret, props) => {
      const ch = props?.channel;
      if (!ch?.id) return;
      const n = getHistory().filter((r) => r.channelId === ch.id).length;
      const sn = snipeCountFor(ch.id);
      pushItems(ret, [
        ContextMenu.buildItem({ type: "separator" }),
        ContextMenu.buildItem({ label: `${NAMES.typing()}${n ? ` (${n})` : ""}`, action: () => openHistory({ channelId: ch.id }) }),
        sn ? ContextMenu.buildItem({ label: `${NAMES.snipe()} (${sn})`, action: () => openSnipe(ch.id) }) : null,
        ContextMenu.buildItem({ type: "toggle", label: L("Ignorar grupo no Lurk", "Ignore group in Lurk"), checked: isIgnoredChannel(ch.id), action: () => toggleIgnore("channels", ch.id, channelLabel(ch)) }),
      ].filter(Boolean));
    }));
    this.unpatchers.push(ContextMenu.patch("channel-context", (ret, props) => {
      const ch = props?.channel;
      if (!ch?.id) return;
      const sn = snipeCountFor(ch.id);
      if (!sn) return;
      pushItems(ret, [
        ContextMenu.buildItem({ type: "separator" }),
        ContextMenu.buildItem({ label: `${NAMES.snipe()} (${sn})`, action: () => openSnipe(ch.id) }),
      ]);
    }));
  }

  stop() {
    try { for (const [ev, fn] of Object.entries(SUBS)) Dispatcher?.unsubscribe(ev, fn); } catch {}
    try { PresenceStore?.removeChangeListener?.(onPresenceChange); } catch {}
    try { SelectedChannelStore?.removeChangeListener?.(this.onChannelSelect); } catch {}
    try { this.onSettings?.(); } catch {}
    snipeActive = false;
    if (window.__dmttSnipeHook === snipeInterceptor) window.__dmttSnipeHook = null;
    sessions.forEach((s) => clearTimeout(s.timer));
    sessions.clear();
    pendingSent.forEach((p) => clearTimeout(p.timer));
    pendingSent.clear();
    for (const id of [...vipVoice.keys()]) safe(() => closeVoice(id, true));
    safe(() => endMyCall(true));
    clearTimeout(this.backupTimer);
    clearInterval(this.backupInterval);
    clearInterval(this.subInterval);
    clearTimeout(this.updateTimer);
    clearInterval(this.updateInterval);
    safe(() => updater.notice?.()); updater.notice = null;
    flushVip();
    flushMentions();
    flushCalls();
    mentionCache.clear();
    reactionCache.clear();
    Patcher.unpatchAll();
    (this.unpatchers || []).forEach((u) => { try { u(); } catch {} });
    this.unpatchers = [];
    stopDOM();
    DOM.removeStyle(PLUGIN);
  }

  getSettingsPanel() {
    lastSeenBeforeOpen = getSeenAt();
    return h("div", { className: "dmtt-settings-host" }, h(App, { initial: [{ type: "home" }, { type: "settings" }] }));
  }
};

function pushItems(ret, items) {
  if (!ret?.props) return;
  const c = ret.props.children;
  if (Array.isArray(c)) c.push(...items);
  else ret.props.children = [c, ...items];
}

