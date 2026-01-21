// ================================
// DOM Elements (UNCHANGED)
// ================================
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const messagesContainer = document.getElementById('messagesContainer');
const newChatBtn = document.getElementById('newChatBtn');
const conversationsList = document.getElementById('conversationsList');
const modelSelect = document.getElementById('modelSelect');
const settingsModal = document.getElementById('settingsModal');
const settingsBtn = document.getElementById('settingsBtn');
const closeSettingsBtns = document.querySelectorAll('.close-btn, #closeSettingsBtn2');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const apiKeyInput = document.getElementById('apiKeyInput');
const temperatureInput = document.getElementById('temperatureInput');
const temperatureValue = document.getElementById('temperatureValue');
const maxTokensInput = document.getElementById('maxTokensInput');
const darkModeToggle = document.getElementById('darkModeToggle');
const typingIndicator = document.getElementById('typingIndicator');
const clearChatBtn = document.getElementById('clearChatBtn');
const exportChatBtn = document.getElementById('exportChatBtn');
const chatTitle = document.getElementById('chatTitle');

// ================================
// Global Variables (UNCHANGED)
// ================================
let currentConversationId = null;
let isStreaming = false;
let config = {};

// ================================
// INIT
// ================================
async function init() {
    loadConfig();
    await loadConversations();
    setupEventListeners();
    updateUI();

    const urlParams = new URLSearchParams(window.location.search);
    const conversationId = urlParams.get('conversation');
    if (conversationId) {
        await loadConversation(conversationId);
    }
}

// ================================
// CONFIG (UNCHANGED)
// ================================
async function loadConfig() {
    try {
        const response = await fetch('/api/config');
        config = await response.json();

        if (config.api_key) apiKeyInput.value = config.api_key;
        if (config.temperature) {
            temperatureInput.value = config.temperature;
            temperatureValue.textContent = config.temperature;
        }
        if (config.max_tokens) maxTokensInput.value = config.max_tokens;
        if (config.model) modelSelect.value = config.model;
        if (config.dark_mode !== undefined) {
            darkModeToggle.checked = config.dark_mode;
            document.body.classList.toggle('light-mode', !config.dark_mode);
        }
    } catch (error) {
        console.error('Failed to load config:', error);
        showError('Failed to load configuration');
    }
}

async function saveConfig() {
    try {
        config.api_key = apiKeyInput.value;
        config.temperature = parseFloat(temperatureInput.value);
        config.max_tokens = parseInt(maxTokensInput.value);
        config.model = modelSelect.value;
        config.dark_mode = darkModeToggle.checked;

        const response = await fetch('/api/update_config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });

        const result = await response.json();
        if (result.success) {
            showNotification('Settings saved successfully!');
            settingsModal.classList.remove('show');
        } else {
            throw new Error(result.error || 'Failed to save settings');
        }
    } catch (error) {
        console.error('Failed to save config:', error);
        showError('Failed to save settings: ' + error.message);
    }
}

// ================================
// CONVERSATIONS (UNCHANGED)
// ================================
async function loadConversations() {
    try {
        const response = await fetch('/api/conversations');
        const conversations = await response.json();

        conversationsList.innerHTML = '';
        conversations.forEach(conv => {
            const convElement = createConversationElement(conv);
            conversationsList.appendChild(convElement);
        });
    } catch (error) {
        console.error('Failed to load conversations:', error);
        showError('Failed to load conversations');
    }
}

function createConversationElement(conversation) {
    const div = document.createElement('div');
    div.className = 'conversation-item';
    if (conversation.id === currentConversationId) {
        div.classList.add('active');
    }

    const title = conversation.title || 'Untitled Conversation';
    const date = new Date(conversation.updated_at).toLocaleDateString();

    div.innerHTML = `
        <div class="conversation-title">${escapeHtml(title)}</div>
        <div class="conversation-meta">
            <span>${conversation.message_count || 0} messages</span>
            <span>${date}</span>
        </div>
    `;

    div.addEventListener('click', () => loadConversation(conversation.id));
    return div;
}

// ================================
// LOAD CONVERSATION (UNCHANGED)
// ================================
async function loadConversation(conversationId) {
    try {
        const response = await fetch(`/api/conversation/${conversationId}`);
        if (!response.ok) {
            if (response.status === 404) {
                await createNewConversation();
                return;
            }
            throw new Error('Failed to load conversation');
        }

        const conversation = await response.json();
        currentConversationId = conversation.id;

        const url = new URL(window.location);
        url.searchParams.set('conversation', conversationId);
        window.history.pushState({}, '', url);

        chatTitle.innerHTML = `<i class="fas fa-comments"></i> ${escapeHtml(conversation.title)}`;

        messagesContainer.innerHTML = '';
        if (conversation.messages?.length) {
            conversation.messages.forEach(msg => addMessageToUI(msg, false));
        } else {
            showWelcomeMessage();
        }

        await loadConversations();
        scrollToBottom();
    } catch (error) {
        console.error('Failed to load conversation:', error);
        showError('Failed to load conversation');
    }
}

// ================================
// SEND MESSAGE (LOGIC SAME)
// ================================
async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message || isStreaming) return;

    const userMessage = {
        role: 'user',
        content: message,
        timestamp: new Date().toISOString()
    };

    addMessageToUI(userMessage, true);

    messageInput.value = '';
    messageInput.style.height = 'auto';
    sendButton.disabled = true;
    updateUI(); // FIX: keep button state in sync

    typingIndicator.style.display = 'flex';
    isStreaming = true;

    try {
        const params = new URLSearchParams({
            message,
            model: modelSelect.value
        });

        if (currentConversationId) {
            params.append('conversation_id', currentConversationId);
        }

        const response = await fetch(`/api/chat/stream?${params}`);
        if (!response.ok) throw new Error(`API Error: ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let assistantMessage = {
            role: 'assistant',
            content: '',
            timestamp: new Date().toISOString()
        };

        const messageElement = createMessageElement(assistantMessage);
        messagesContainer.appendChild(messageElement);

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6);

                if (data === '[DONE]') {
                    isStreaming = false;
                    sendButton.disabled = false;
                    typingIndicator.style.display = 'none';
                    await loadConversations();
                    updateUI();
                    return;
                }

                try {
                    const parsed = JSON.parse(data);
                    if (parsed?.content) {
                        assistantMessage.content += parsed.content;
                        updateMessageContent(messageElement, assistantMessage.content);
                    }
                } catch {}
            }
        }
    } catch (error) {
        console.error('Failed to send message:', error);
        showError('Failed to send message: ' + error.message);
        isStreaming = false;
        sendButton.disabled = false;
        typingIndicator.style.display = 'none';
        updateUI();
    }
}

// ================================
// UI HELPERS (UNCHANGED)
// ================================
function addMessageToUI(message, isNew = false) {
    const el = createMessageElement(message);
    messagesContainer.appendChild(el);
    if (isNew) scrollToBottom();
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// ================================
// EVENT LISTENERS (MOBILE SAFE)
// ================================
function setupEventListeners() {

    messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
        updateUI();
    });

    // FIX: mobile-safe Enter handling (logic SAME)
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!isStreaming && messageInput.value.trim()) {
                sendMessage();
            }
        }
    });

    sendButton.addEventListener('click', sendMessage);

    newChatBtn.addEventListener('click', async () => {
        currentConversationId = null;
        const url = new URL(window.location);
        url.searchParams.delete('conversation');
        window.history.pushState({}, '', url);

        chatTitle.innerHTML = '<i class="fas fa-comments"></i> New Conversation';
        showWelcomeMessage();
        await loadConversations();
    });

    settingsBtn.addEventListener('click', () => settingsModal.classList.add('show'));
    closeSettingsBtns.forEach(btn => btn.addEventListener('click', () => settingsModal.classList.remove('show')));

    saveSettingsBtn.addEventListener('click', saveConfig);
    clearChatBtn.addEventListener('click', clearChat);
    exportChatBtn.addEventListener('click', exportChat);

    window.addEventListener('popstate', async () => {
        const id = new URLSearchParams(window.location.search).get('conversation');
        if (id) await loadConversation(id);
        else {
            currentConversationId = null;
            chatTitle.innerHTML = '<i class="fas fa-comments"></i> New Conversation';
            showWelcomeMessage();
            await loadConversations();
        }
    });
}

// ================================
document.addEventListener('DOMContentLoaded', init);