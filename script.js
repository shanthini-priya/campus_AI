"use strict";

/* ==========================================================================
   KCE Campus AI — local-first college chatbot
   Vanilla JavaScript. No build step, no framework, no credentials.

   Answers come from the verified local knowledge base in
   knowledge/kce-knowledge.json via knowledge/kce-retrieval.js. This is
   deterministic retrieval, not a generative AI model. No AWS or paid API is
   required.

   Optional backend: leave API_ENDPOINT empty to use the local engine, or set it
   (for example "/api/chat" when running backend/server.py) to use the local
   Python API instead. The endpoint accepts { "message": "..." } and returns
   { "answer": "...", "sources": [...], "followups": [...] }.
   ========================================================================== */

const API_ENDPOINT = "";
const THEME_STORAGE_KEY = "kce-campusai-theme";
const API_TIMEOUT_MS = 6000;
const LOCAL_DELAY_MS = 120;

/* ---------- Small helpers ---------- */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const state = {
  view: "assistant",
  messages: [],
  isTyping: false,
  replyToken: 0,
  theme: "light",
  lastFocused: null
};

const dom = {};
let hasStartedChat = false;

function createEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function createIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.appendChild(use);
  return svg;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function makeId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatTime(date) {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  } catch (error) {
    return date.toLocaleTimeString();
  }
}

function isEditableTarget(target) {
  return (
    target instanceof HTMLElement &&
    (target.matches("input, textarea, select") || target.isContentEditable)
  );
}

/* ---------- Toast notifications ---------- */

function showToast(message, variant = "success", duration = 3200) {
  if (!dom.toastRegion || !message) return;

  while (dom.toastRegion.children.length >= 3) {
    dom.toastRegion.firstElementChild.remove();
  }

  const toast = createEl("div", `toast${variant === "error" ? " toast-error" : ""}`);
  const iconName = variant === "error" ? "alert-circle" : variant === "info" ? "info" : "check";
  toast.appendChild(createIcon(iconName));
  const text = createEl("span", "", message);
  toast.appendChild(text);
  dom.toastRegion.appendChild(toast);

  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 240);
  }, duration);
}

/* ---------- Theme handling ---------- */

function getStoredTheme() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : null;
  } catch (error) {
    return null;
  }
}

function applyTheme(theme, persist = false) {
  const next = theme === "dark" ? "dark" : "light";
  state.theme = next;
  document.documentElement.setAttribute("data-theme", next);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", next === "dark" ? "#0c0917" : "#f5f2fc");

  if (dom.themeQuickToggle) {
    const label = next === "dark" ? "Switch to light mode" : "Switch to dark mode";
    dom.themeQuickToggle.replaceChildren(createIcon(next === "dark" ? "sun" : "moon"));
    dom.themeQuickToggle.setAttribute("aria-label", label);
    dom.themeQuickToggle.title = label;
  }

  if (dom.themeChoiceButtons) {
    dom.themeChoiceButtons.forEach((button) => {
      const active = button.dataset.themeChoice === next;
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("is-active", active);
    });
  }

  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch (error) {
      showToast("Theme applied, but this browser blocked saving the preference.", "error");
    }
  }
}

function toggleTheme() {
  applyTheme(state.theme === "dark" ? "light" : "dark", true);
}

/* ---------- Navigation ---------- */

const VIEW_META = {
  assistant: { title: "KCE AI Assistant", documentTitle: "AI Assistant" },
  "about-kce": { title: "About KCE", documentTitle: "About KCE" },
  courses: { title: "Courses & Departments", documentTitle: "Courses & Departments" },
  admissions: { title: "Admissions", documentTitle: "Admissions" },
  academics: { title: "Academic Information", documentTitle: "Academic Information" },
  facilities: { title: "Campus Facilities", documentTitle: "Campus Facilities" },
  placements: { title: "Placements", documentTitle: "Placements" },
  announcements: { title: "College Announcements", documentTitle: "College Announcements" },
  settings: { title: "Settings", documentTitle: "Settings" },
  about: { title: "About Project", documentTitle: "About Project" }
};

function navigateTo(view, options = {}) {
  if (!VIEW_META[view]) return;

  const { focusMain = false } = options;
  const wasDrawerOpen = dom.app.classList.contains("sidebar-open");
  state.view = view;

  dom.navItems.forEach((item) => {
    const active = item.dataset.view === view;
    item.classList.toggle("is-active", active);
    if (active) {
      item.setAttribute("aria-current", "page");
    } else {
      item.removeAttribute("aria-current");
    }
  });

  $$(".view", dom.main).forEach((section) => {
    section.classList.toggle("is-active", section.id === `view-${view}`);
  });

  if (dom.viewTitle) dom.viewTitle.textContent = VIEW_META[view].title;
  document.title = `${VIEW_META[view].documentTitle} · KCE Campus AI`;

  closeMobileSidebar({ restoreFocus: false });
  if (wasDrawerOpen || focusMain) {
    dom.main.focus({ preventScroll: true });
  }

  window.scrollTo({ top: 0, left: 0, behavior: "auto" });

  if (view === "assistant") {
    window.requestAnimationFrame(() => {
      scrollChatToBottom("auto");
      resizeComposer();
    });
  } else if (["about-kce", "courses", "admissions", "academics", "facilities", "placements", "announcements", "about", "settings"].includes(view)) {
    // Static/info views - nothing special needed
  }
}

/* ---------- Responsive sidebar ---------- */

const mobileQuery = window.matchMedia("(max-width: 960px)");

function syncSidebarForViewport() {
  if (mobileQuery.matches) {
    dom.app.classList.remove("sidebar-collapsed");
    if (!dom.app.classList.contains("sidebar-open")) {
      dom.sidebar.setAttribute("inert", "");
    } else {
      dom.sidebar.removeAttribute("inert");
    }
  } else {
    dom.sidebar.removeAttribute("inert");
    dom.app.classList.remove("sidebar-open");
    document.body.classList.remove("drawer-open");
    dom.menuBtn.setAttribute("aria-expanded", "false");
    dom.menuBtn.setAttribute("aria-label", "Open navigation");
  }
}

function openMobileSidebar() {
  if (!mobileQuery.matches) return;

  dom.app.classList.add("sidebar-open");
  dom.sidebar.removeAttribute("inert");
  dom.menuBtn.setAttribute("aria-expanded", "true");
  dom.menuBtn.setAttribute("aria-label", "Close navigation");
  document.body.classList.add("drawer-open");

  const target = dom.sidebar.querySelector(".nav-item.is-active") || dom.sidebar.querySelector(".nav-item");
  window.requestAnimationFrame(() => {
    if (target) target.focus({ preventScroll: true });
  });
}

function closeMobileSidebar({ restoreFocus = true } = {}) {
  const wasOpen = dom.app.classList.contains("sidebar-open");
  if (!wasOpen) {
    if (mobileQuery.matches) dom.sidebar.setAttribute("inert", "");
    return;
  }

  if (restoreFocus) dom.menuBtn.focus({ preventScroll: true });

  dom.app.classList.remove("sidebar-open");
  document.body.classList.remove("drawer-open");
  dom.menuBtn.setAttribute("aria-expanded", "false");
  dom.menuBtn.setAttribute("aria-label", "Open navigation");

  if (mobileQuery.matches) dom.sidebar.setAttribute("inert", "");
}

function toggleSidebarCollapse() {
  if (mobileQuery.matches) return;

  const collapsed = dom.app.classList.toggle("sidebar-collapsed");
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  dom.sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
  dom.sidebarToggle.setAttribute("aria-label", label);
  dom.sidebarToggle.title = label;
}

function getLocalReply(question) {
  if (window.KCERetrieval && window.KCERetrieval.isReady()) {
    return window.KCERetrieval.answer(question);
  }

  return {
    text:
      "The local KCE knowledge base did not load, so I can't answer reliably right now.\n\n" +
      "Please refresh the page, or contact the college office:\n" +
      "• Website: https://kingsengg.edu.in/\n" +
      "• Phone: +91-6380989024\n" +
      "• Email: contact@kingsengg.edu.in",
    sources: [
      { title: "KCE Home", url: "https://kingsengg.edu.in/" },
      { title: "Contact Us", url: "https://kingsengg.edu.in/contact.html" }
    ],
    followups: [],
    source: "local",
    error: true
  };
}

/* ---------- Answer service (local first, optional API) ---------- */

function normalizeSources(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") {
        return { title: item, url: item };
      }
      if (item && typeof item === "object" && typeof item.url === "string") {
        return {
          title: typeof item.title === "string" && item.title.trim() ? item.title : item.url,
          url: item.url
        };
      }
      return null;
    })
    .filter(Boolean)
    .slice(0, 4);
}

async function requestAnswer(question) {
  /* Default path: deterministic local retrieval. Synchronous and cannot hang. */
  if (!API_ENDPOINT.trim()) {
    await wait(LOCAL_DELAY_MS);
    try {
      return getLocalReply(question);
    } catch (error) {
      console.error("Local knowledge-base answer failed:", error);
      return {
        text:
          "I hit an unexpected error while reading the local KCE knowledge base. Please refresh the page and try again.\n\n" +
          "Website: https://kingsengg.edu.in/ · Phone: +91-6380989024",
        sources: [],
        followups: [],
        retryQuestion: question,
        source: "local",
        error: true
      };
    }
  }

  /* Optional path: a local/remote backend API, with a hard timeout. */
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ message: question }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const data = await response.json();
    const answer =
      typeof data.answer === "string" ? data.answer :
      typeof data.reply === "string" ? data.reply :
      typeof data.message === "string" ? data.message : "";

    if (!answer.trim()) {
      throw new Error("The API returned an empty answer.");
    }

    const followups = Array.isArray(data.followups)
      ? data.followups.filter((item) => typeof item === "string" && item.trim()).slice(0, 3)
      : [];

    return {
      text: answer.trim(),
      sources: normalizeSources(data.sources),
      followups,
      source: "api"
    };
  } catch (error) {
    console.error("Answer API request failed:", error);
    return {
      text:
        "I couldn't reach the answer service just now. Please check your connection and try again.\n\n" +
        "If the problem continues, contact the college office for help.",
      sources: [],
      followups: [],
      retryQuestion: question,
      source: "api",
      error: true
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

/* ---------- Chat rendering ---------- */

function createAvatar(role) {
  const avatar = createEl("span", `msg-avatar msg-avatar-${role}`);
  avatar.setAttribute("aria-hidden", "true");
  if (role === "assistant") {
    avatar.appendChild(createIcon("sparkles"));
  } else {
    avatar.textContent = "S";
  }
  return avatar;
}

function setCopyButtonState(button, copied) {
  button.replaceChildren(createIcon(copied ? "check" : "copy"));
  button.appendChild(createEl("span", "", copied ? "Copied" : "Copy"));
  button.setAttribute("aria-label", copied ? "Answer copied" : "Copy answer");
}

function createCopyButton(text) {
  const button = createEl("button", "copy-btn");
  button.type = "button";
  setCopyButtonState(button, false);
  button.addEventListener("click", async () => {
    const copied = await copyToClipboard(text);
    if (copied) {
      setCopyButtonState(button, true);
      showToast("Answer copied to clipboard.");
      window.setTimeout(() => {
        if (button.isConnected) setCopyButtonState(button, false);
      }, 2200);
    } else {
      showToast("Could not copy automatically. Please select the text manually.", "error");
    }
  });
  return button;
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {
    /* Fall through to the legacy copy path. */
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-1000px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch (error) {
    return false;
  }
}

function createMessageElement(message) {
  const article = createEl(
    "article",
    `message message-${message.role}${message.error ? " is-error" : ""}`
  );
  article.dataset.messageId = message.id;

  article.appendChild(createAvatar(message.role));

  const main = createEl("div", "msg-main");
  const meta = createEl("div", "msg-meta");

  meta.appendChild(createEl("span", "msg-author", message.role === "user" ? "You" : "KCE Campus AI"));

  const time = createEl("time", "msg-time", formatTime(message.time));
  time.dateTime = message.time.toISOString();
  meta.appendChild(time);

  if (message.role === "assistant") {
    meta.appendChild(createCopyButton(message.text));
  }

  main.appendChild(meta);

  const bubble = createEl("div", "bubble", message.text);
  main.appendChild(bubble);

  const sources = normalizeSources(message.sources);
  if (message.role === "assistant" && sources.length) {
    const sourceBox = createEl("div", "msg-sources");
    sourceBox.appendChild(createEl("span", "msg-sources-label", "Official sources"));
    sources.forEach((source) => {
      const link = createEl("a", "msg-source-link", source.title);
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      sourceBox.appendChild(link);
    });
    main.appendChild(sourceBox);
  }

  const followups = [];
  if (message.retryQuestion) followups.push({ label: "Try again", question: message.retryQuestion, retry: true });
  if (Array.isArray(message.followups)) {
    message.followups.forEach((question) => {
      if (typeof question === "string" && question.trim()) followups.push({ label: question, question });
    });
  }

  if (followups.length) {
    const list = createEl("div", "followups");
    followups.forEach((item) => {
      const chip = createEl("button", `chip${item.retry ? " chip-retry" : ""}`, item.label);
      chip.type = "button";
      chip.addEventListener("click", () => sendMessage(item.question));
      list.appendChild(chip);
    });
    main.appendChild(list);
  }

  article.appendChild(main);
  return article;
}

function showTypingIndicator() {
  hideTypingIndicator();

  const article = createEl("article", "message message-assistant typing-message");
  article.setAttribute("aria-label", "CampusAI is typing");
  article.appendChild(createAvatar("assistant"));

  const main = createEl("div", "msg-main");
  const meta = createEl("div", "msg-meta");
  meta.appendChild(createEl("span", "msg-author", "CampusAI"));
  meta.appendChild(createEl("span", "msg-time", "Thinking…"));
  main.appendChild(meta);

  const bubble = createEl("div", "bubble typing-bubble");
  const dots = createEl("span", "typing-dots");
  dots.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 3; index += 1) {
    dots.appendChild(createEl("span"));
  }
  bubble.appendChild(dots);
  bubble.appendChild(createEl("span", "sr-only", "CampusAI is typing an answer."));
  main.appendChild(bubble);
  article.appendChild(main);

  dom.messages.appendChild(article);
  dom.typingElement = article;
  dom.messages.setAttribute("aria-busy", "true");
  scrollChatToBottom();
}

function hideTypingIndicator() {
  if (dom.typingElement && dom.typingElement.isConnected) {
    dom.typingElement.remove();
  }
  dom.typingElement = null;
  if (dom.messages) dom.messages.setAttribute("aria-busy", "false");
}

function scrollChatToBottom(behavior = "smooth") {
  if (!dom.chatScroll) return;
  window.requestAnimationFrame(() => {
    dom.chatScroll.scrollTo({
      top: dom.chatScroll.scrollHeight,
      behavior: prefersReducedMotion() ? "auto" : behavior
    });
  });
}

function updateChatUI() {
  const hasConversation = state.messages.length > 0 || state.isTyping;
  const showConversation = hasConversation || hasStartedChat;
  if (dom.welcome) dom.welcome.hidden = showConversation;
  if (dom.conversationHeader) dom.conversationHeader.hidden = !showConversation;
  if (dom.messages) dom.messages.hidden = !showConversation;
  if (dom.composerSticky) dom.composerSticky.hidden = !showConversation;
  if (dom.clearChatTop) dom.clearChatTop.disabled = state.messages.length === 0 && !state.isTyping;
}

function resizeComposerSticky() {
  if (!dom.chatInputSticky) return;
  dom.chatInputSticky.style.height = "auto";
  dom.chatInputSticky.style.height = `${Math.min(dom.chatInputSticky.scrollHeight, 160)}px`;
}

function updateSendState() {
  if (dom.sendBtn) {
    dom.sendBtn.disabled = state.isTyping || (dom.chatInput ? dom.chatInput.value.trim().length === 0 : true);
  }
  if (dom.sendBtnSticky) {
    dom.sendBtnSticky.disabled = state.isTyping || (dom.chatInputSticky ? dom.chatInputSticky.value.trim().length === 0 : true);
  }
  if (dom.composer) dom.composer.classList.toggle("is-busy", state.isTyping);
}

function resizeComposer() {
  if (!dom.chatInput) return;
  dom.chatInput.style.height = "auto";
  dom.chatInput.style.height = `${Math.min(dom.chatInput.scrollHeight, 160)}px`;
}

function resetComposer() {
  if (dom.chatInput) {
    dom.chatInput.value = "";
    resizeComposer();
  }
  if (dom.chatInputSticky) {
    dom.chatInputSticky.value = "";
    resizeComposerSticky();
  }
  updateSendState();
}

function addMessageToConversation(message) {
  state.messages.push(message);
  dom.messages.appendChild(createMessageElement(message));
  updateChatUI();
  scrollChatToBottom();
}

async function sendMessage(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return;

  if (state.isTyping) {
    showToast("KCE Campus AI is still answering. Give it a moment.", "info");
    return;
  }

  hasStartedChat = true;
  if (dom.welcome) dom.welcome.hidden = true;

  const token = ++state.replyToken;

  addMessageToConversation({
    id: makeId(),
    role: "user",
    text,
    time: new Date()
  });

  if (dom.chatInput) dom.chatInput.value = "";
  if (dom.chatInputSticky) dom.chatInputSticky.value = "";
  resizeComposer();
  resizeComposerSticky();
  updateSendState();
  state.isTyping = true;
  updateSendState();
  updateChatUI();
  showTypingIndicator();
  scrollChatToBottom();

  let reply;
  try {
    reply = await requestAnswer(text);
  } catch (error) {
    console.error("Answer request failed:", error);
    reply = {
      text:
        "Something went wrong while answering that question. Please try again.\n\n" +
        "If it keeps happening, contact the college office: +91-6380989024",
      sources: [],
      followups: [],
      retryQuestion: text,
      error: true
    };
  } finally {
    /* Always clear the typing state so the UI can never get stuck. */
    if (token === state.replyToken) {
      hideTypingIndicator();
      state.isTyping = false;
      updateSendState();
    }
  }

  if (token !== state.replyToken) {
    return;
  }

  addMessageToConversation({
    id: makeId(),
    role: "assistant",
    text: reply.text,
    time: new Date(),
    source: reply.source,
    sources: reply.sources || [],
    followups: reply.followups || [],
    retryQuestion: reply.retryQuestion,
    error: Boolean(reply.error)
  });

  updateSendState();
  updateChatUI();
  scrollChatToBottom();
}

function clearConversation({ focusComposer = false, notify = true } = {}) {
  state.replyToken += 1;
  state.isTyping = false;
  state.messages = [];
  hasStartedChat = false;
  hideTypingIndicator();

  if (dom.messages) dom.messages.replaceChildren();
  if (dom.chatInput) {
    dom.chatInput.value = "";
    resizeComposer();
  }
  if (dom.chatInputSticky) {
    dom.chatInputSticky.value = "";
    resizeComposerSticky();
  }
  updateChatUI();
  updateSendState();

  if (notify) showToast("Conversation cleared.");

  if (focusComposer && state.view === "assistant") {
    window.setTimeout(() => {
      if (dom.chatInput) dom.chatInput.focus({ preventScroll: true });
    }, 60);
  }
}

/* ---------- Clear-chat dialog ---------- */

function openClearDialog() {
  if (state.messages.length === 0 && !state.isTyping) {
    showToast("There is no conversation to clear yet.", "info");
    return;
  }

  state.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dom.clearDialog.hidden = false;
  document.body.classList.add("modal-open");

  window.requestAnimationFrame(() => {
    if (dom.cancelClear) dom.cancelClear.focus();
  });
}

function closeClearDialog({ restoreFocus = true } = {}) {
  if (!dom.clearDialog || dom.clearDialog.hidden) return;

  dom.clearDialog.hidden = true;
  document.body.classList.remove("modal-open");

  if (restoreFocus && state.lastFocused && state.lastFocused.isConnected) {
    state.lastFocused.focus({ preventScroll: true });
  }
}

function trapDialogFocus(event) {
  if (!dom.clearDialog || dom.clearDialog.hidden) return;

  if (event.key === "Escape") {
    event.preventDefault();
    closeClearDialog();
    return;
  }

  if (event.key !== "Tab") return;

  const focusable = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', dom.clearDialog)
    .filter((element) => !element.disabled && element.offsetParent !== null);

  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}



/* ---------- Connection / engine status ---------- */

function updateConnectionUI() {
  const hasEndpoint = Boolean(API_ENDPOINT.trim());
  const kbReady = Boolean(window.KCERetrieval && window.KCERetrieval.isReady());
  const engineLabel = kbReady ? "Local knowledge base" : "Knowledge base unavailable";

  if (dom.demoFullLabel && dom.demoShortLabel) {
    dom.demoFullLabel.textContent = "Local KB";
    dom.demoShortLabel.textContent = "Local";
  }

  if (dom.demoModeIndicator) {
    dom.demoModeIndicator.textContent = "Local KB";
  }

  if (dom.demoChip) {
    dom.demoChip.title = hasEndpoint
      ? "Optional local API endpoint configured. Answers come from the verified KCE knowledge base."
      : "Answers come from the verified local KCE knowledge base. No AWS or paid API is used.";
    dom.demoChip.classList.remove("demo-chip-live");
  }

  if (dom.demoStatusTitle) {
    dom.demoStatusTitle.textContent = "Local knowledge base active";
  }

  if (dom.demoStatusCopy) {
    dom.demoStatusCopy.textContent =
      "Answers are retrieved deterministically from verified KCE information. No AWS account or paid AI API is used.";
  }

  if (dom.responseSourceValue) {
    dom.responseSourceValue.textContent = hasEndpoint
      ? "Local API + knowledge base"
      : "Local knowledge base";
  }

  if (dom.endpointStatusValue) {
    dom.endpointStatusValue.textContent = hasEndpoint ? "Configured" : "Not used";
  }

  if (dom.modelStatusValue) {
    dom.modelStatusValue.textContent = engineLabel;
  }

  if (dom.statusPanelDot) {
    dom.statusPanelDot.classList.remove("status-dot-warn");
    dom.statusPanelDot.classList.add("status-dot-live");
  }

  if (dom.composerNoteText) {
    dom.composerNoteText.textContent = kbReady
      ? "Answers from verified KCE knowledge"
      : "Knowledge base failed to load — refresh the page";
  }
}

/* ---------- Events ---------- */

function bindEvents() {
  /* Navigation and in-app links */
  $$("[data-view]").forEach((trigger) => {
    trigger.addEventListener("click", () => {
      navigateTo(trigger.dataset.view);
    });
  });

  /* Desktop sidebar collapse */
  if (dom.sidebarToggle) {
    dom.sidebarToggle.addEventListener("click", toggleSidebarCollapse);
  }

  /* Mobile drawer */
  if (dom.menuBtn) {
    dom.menuBtn.addEventListener("click", () => {
      if (dom.app.classList.contains("sidebar-open")) {
        closeMobileSidebar();
      } else {
        openMobileSidebar();
      }
    });
  }

  if (dom.scrim) {
    dom.scrim.addEventListener("click", () => closeMobileSidebar());
  }

  if (typeof mobileQuery.addEventListener === "function") {
    mobileQuery.addEventListener("change", syncSidebarForViewport);
  } else if (typeof mobileQuery.addListener === "function") {
    mobileQuery.addListener(syncSidebarForViewport);
  }

  /* Theme */
  if (dom.themeQuickToggle) {
    dom.themeQuickToggle.addEventListener("click", toggleTheme);
  }

  if (dom.themeControl) {
    dom.themeControl.addEventListener("click", (event) => {
      const button = event.target.closest("[data-theme-choice]");
      if (!button) return;
      applyTheme(button.dataset.themeChoice, true);
    });
  }

  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  const handleSystemTheme = (event) => {
    if (!getStoredTheme()) applyTheme(event.matches ? "dark" : "light", false);
  };
  if (typeof systemTheme.addEventListener === "function") {
    systemTheme.addEventListener("change", handleSystemTheme);
  } else if (typeof systemTheme.addListener === "function") {
    systemTheme.addListener(handleSystemTheme);
  }

  /* Composer */
  if (dom.chatInput) {
    dom.chatInput.addEventListener("input", () => {
      resizeComposer();
      updateSendState();
    });

    dom.chatInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (dom.sendBtn && !dom.sendBtn.disabled && dom.composer) {
          dom.composer.requestSubmit();
        }
      }
    });
  }
  if (dom.chatInputSticky) {
    dom.chatInputSticky.addEventListener("input", () => {
      resizeComposerSticky();
      updateSendState();
    });

    dom.chatInputSticky.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (dom.sendBtnSticky && !dom.sendBtnSticky.disabled && dom.composerStickyForm) {
          dom.composerStickyForm.requestSubmit();
        }
      }
    });
  }

  if (dom.composer) {
    dom.composer.addEventListener("submit", (event) => {
      event.preventDefault();
      if (dom.chatInput) sendMessage(dom.chatInput.value);
    });
  }
  if (dom.composerStickyForm) {
    dom.composerStickyForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (dom.chatInputSticky) sendMessage(dom.chatInputSticky.value);
    });
  }

  if (dom.attachBtn) {
    dom.attachBtn.addEventListener("click", () => {
      showToast("File attachments are not available.", "info");
    });
  }
  const attachBtn2 = document.getElementById("attachBtn2");
  if (attachBtn2) {
    attachBtn2.addEventListener("click", () => {
      showToast("File attachments are not available.", "info");
    });
  }

  /* Suggestion cards */
  $$(".suggestion-card").forEach((card) => {
    card.addEventListener("click", () => {
      const question = card.dataset.question;
      if (question) sendMessage(question);
    });
  });
  $$(".hero-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const question = chip.dataset.question;
      if (question) sendMessage(question);
    });
  });

  /* Clear chat actions */
  if (dom.clearChatTop) dom.clearChatTop.addEventListener("click", openClearDialog);
  if (dom.settingsClearChat) dom.settingsClearChat.addEventListener("click", openClearDialog);

  if (dom.newChatBtn) {
    dom.newChatBtn.addEventListener("click", () => {
      clearConversation({ focusComposer: true, notify: false });
      navigateTo("assistant");
      if (dom.chatInput) {
        window.setTimeout(() => dom.chatInput.focus(), 60);
      }
    });
  }
  if (dom.newChatSidebarBtn) {
    dom.newChatSidebarBtn.addEventListener("click", () => {
      clearConversation({ focusComposer: true, notify: false });
      navigateTo("assistant");
      if (dom.chatInput) {
        window.setTimeout(() => dom.chatInput.focus(), 60);
      }
    });
  }

  if (dom.cancelClear) {
    dom.cancelClear.addEventListener("click", () => closeClearDialog());
  }

  if (dom.confirmClear) {
    dom.confirmClear.addEventListener("click", () => {
      closeClearDialog({ restoreFocus: true });
      clearConversation({ focusComposer: state.view === "assistant" });
    });
  }

  if (dom.clearDialog) {
    dom.clearDialog.addEventListener("keydown", trapDialogFocus);
    dom.clearDialog.addEventListener("click", (event) => {
      if (event.target === dom.clearDialog) closeClearDialog();
    });
  }



  /* Global keyboard shortcuts */
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (dom.clearDialog && !dom.clearDialog.hidden) {
        closeClearDialog();
        return;
      }
      if (dom.app.classList.contains("sidebar-open")) {
        closeMobileSidebar();
        return;
      }
    }
  });
}

/* ---------- Initialisation ---------- */

function cacheDom() {
  dom.app = $("#app");
  dom.main = $("#mainContent");
  dom.sidebar = $("#sidebar");
  dom.sidebarToggle = $("#sidebarToggle");
  dom.menuBtn = $("#menuBtn");
  dom.scrim = $("#scrim");
  dom.navItems = $$(".nav-item");
  dom.viewTitle = $("#viewTitle");

  dom.themeQuickToggle = $("#themeQuickToggle");
  dom.themeControl = $("#themeControl");
  dom.themeChoiceButtons = $$("[data-theme-choice]", dom.themeControl || document);

  dom.demoChip = $("#demoChip");
  dom.demoFullLabel = $("#demoFullLabel") || $(".demo-full", dom.demoChip || document);
  dom.demoShortLabel = $("#demoShortLabel") || $(".demo-short", dom.demoChip || document);
  dom.demoModeIndicator = $("#demoModeIndicator");
  dom.composerNote = $("#composerNote");
  dom.composerNoteText = $("#composerNoteText");
  dom.statusPanelDot = $("#statusPanelDot");

  dom.welcome = $("#welcome");
  dom.messages = $("#messages");
  dom.chatScroll = $("#chatScroll");
  dom.chatInput = $("#chatInput");
  dom.composer = $("#composer");
  dom.sendBtn = $("#sendBtn");
  dom.attachBtn = $("#attachBtn");
  dom.clearChatTop = $("#clearChatTop");
  dom.clearDialog = $("#clearDialog");
  dom.cancelClear = $("#cancelClear");
  dom.confirmClear = $("#confirmClear");
  dom.toastRegion = $("#toastRegion");
  dom.conversationHeader = $("#conversationHeader");
  dom.newChatBtn = $("#newChatBtn");
  dom.newChatSidebarBtn = $("#newChatSidebarBtn");
  dom.composerSticky = $("#composerSticky");
  dom.chatInputSticky = $("#chatInputSticky");
  dom.sendBtnSticky = $("#sendBtnSticky");
  dom.composerStickyForm = $("#composerStickyForm");



  dom.settingsClearChat = $("#settingsClearChat");
  dom.demoStatusTitle = $("#demoStatusTitle");
  dom.demoStatusCopy = $("#demoStatusCopy");
  dom.responseSourceValue = $("#responseSourceValue");
  dom.endpointStatusValue = $("#endpointStatusValue");
  dom.modelStatusValue = $("#modelStatusValue");
  if (!dom.statusPanelDot) dom.statusPanelDot = $(".status-panel .status-dot");
}

function init() {
  cacheDom();

  const currentTheme = document.documentElement.getAttribute("data-theme");
  state.theme = currentTheme === "dark" ? "dark" : "light";

  applyTheme(state.theme, false);
  updateConnectionUI();
  bindEvents();
  syncSidebarForViewport();
  updateChatUI();
  updateSendState();
  resizeComposer();
  resizeComposerSticky();
  navigateTo("assistant");
}

init();
