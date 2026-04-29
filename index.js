/**
 * Impersonation Bot Plugin
 * 
 * For Kettu / Bunny / Vendetta / Revenge / Equicord
 * Auto-detects which mod framework is available.
 * 
 * Install: https://cdn.jsdelivr.net/gh/0xAndrei/imperso@main/manifest.json
 */

// ==================== FRAMEWORK DETECTION ====================
// Kettu may expose itself as vendetta, kettu, or bunny
const framework = window.vendetta || window.kettu || window.bunny || {};
const metro = framework.metro;
const patcher = framework.patcher;
const ui = framework.ui || {};
const showToast = ui.toasts?.showToast || ui.showToast || ((msg) => console.log("[ImpBot]", msg));
const storage = framework.storage || framework.settings?.storage || {};

const PLUGIN_ID = "impersonation-bot";

// ==================== CONFIG ====================
const API_BASE = (storage && storage.apiUrl) || "http://192.168.0.52:8080/api";
const SYNC_INTERVAL = 4000;

// ==================== STATE ====================
const changes = {
    edits: new Map(),
    names: new Map(),
};
let currentUserId = null;
let unpatches = [];
let syncTimer = null;

function log(...args) {
    console.log(`[${PLUGIN_ID}]`, ...args);
}

// ==================== API SYNC ====================

async function syncChanges() {
    if (!currentUserId) {
        try {
            if (!metro) return;
            const UserStore = metro.findByStoreName?.("UserStore");
            const user = UserStore?.getCurrentUser?.();
            if (user?.id) {
                currentUserId = user.id;
                log("User ID:", currentUserId);
            }
        } catch (e) {}
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/changes/${currentUserId}`, {
            method: "GET",
            headers: { "Accept": "application/json" }
        });

        if (!response.ok) return;
        const data = await response.json();

        if (data.message_edits) {
            for (const edit of data.message_edits) {
                changes.edits.set(edit.message_id, edit.new_content);
            }
        }
        if (data.name_changes) {
            for (const nc of data.name_changes) {
                changes.names.set(nc.target_user_id, nc.new_name);
            }
        }
        log("Synced:", changes.edits.size, "edits,", changes.names.size, "names");
    } catch (e) {
        // Silently fail - API offline is ok
    }
}

// ==================== MESSAGE PATCHING ====================

function patchMessages() {
    try {
        if (!metro || !patcher) {
            log("Metro or patcher not available");
            return;
        }

        const MessageStore = metro.findByStoreName?.("MessageStore");
        if (!MessageStore) {
            log("MessageStore not found");
            return;
        }
        
        if (MessageStore.getMessage) {
            const unpatch = patcher.instead("getMessage", MessageStore, function(args, orig) {
                const msg = orig.apply(this, args);
                if (!msg || !msg.id) return msg;
                
                const edit = changes.edits.get(msg.id);
                if (edit) {
                    try {
                        const modified = Object.create(Object.getPrototypeOf(msg));
                        Object.assign(modified, msg);
                        modified.content = edit;
                        modified.editedTimestamp = Date.now();
                        modified.__impersonationEdited = true;
                        return modified;
                    } catch (e) {
                        return msg;
                    }
                }
                return msg;
            });
            unpatches.push(unpatch);
            log("Patched getMessage");
        }

        if (MessageStore.getMessages) {
            const unpatch = patcher.after("getMessages", MessageStore, (args, res) => {
                if (!res || !res._array || !res._array.length) return res;
                res._array = res._array.map(msg => {
                    const edit = changes.edits.get(msg.id);
                    if (edit && !msg.__impersonationPatched) {
                        return { 
                            ...msg, 
                            content: edit, 
                            editedTimestamp: Date.now(), 
                            __impersonationPatched: true 
                        };
                    }
                    return msg;
                });
                return res;
            });
            unpatches.push(unpatch);
            log("Patched getMessages");
        }

    } catch (e) {
        log("Message patch error:", e.message || e);
    }
}

// ==================== NAME PATCHING ====================

function patchNames() {
    try {
        if (!metro || !patcher) return;

        const UserStore = metro.findByStoreName?.("UserStore");
        if (UserStore && UserStore.getUser) {
            const unpatch = patcher.after("getUser", UserStore, (args, res) => {
                if (!res || !res.id) return res;
                const name = changes.names.get(res.id);
                if (name) {
                    return { ...res, username: name, globalName: name, displayName: name };
                }
                return res;
            });
            unpatches.push(unpatch);
            log("Patched getUser");
        }

        const GuildMemberStore = metro.findByStoreName?.("GuildMemberStore");
        if (GuildMemberStore && GuildMemberStore.getMember) {
            const unpatch = patcher.after("getMember", GuildMemberStore, (args, res) => {
                if (!res || !res.userId) return res;
                const name = changes.names.get(res.userId);
                if (name) {
                    return { ...res, nick: name, displayName: name };
                }
                return res;
            });
            unpatches.push(unpatch);
            log("Patched getMember");
        }

    } catch (e) {
        log("Name patch error:", e.message || e);
    }
}

// ==================== LIFECYCLE ====================

export default {
    onLoad() {
        log("Loading...");
        log("Framework:", window.vendetta ? "vendetta" : window.kettu ? "kettu" : window.bunny ? "bunny" : "none");
        log("Metro:", !!metro, "Patcher:", !!patcher);
        log("API:", API_BASE);

        setTimeout(() => {
            try {
                patchMessages();
                patchNames();

                syncChanges();
                syncTimer = setInterval(syncChanges, SYNC_INTERVAL);

                showToast("Impersonation Bot active");
                log("Ready");
            } catch (e) {
                log("Init error:", e.message || e);
            }
        }, 3000);
    },

    onUnload() {
        log("Unloading...");
        if (syncTimer) clearInterval(syncTimer);
        unpatches.forEach(u => {
            try { u && u(); } catch (e) {}
        });
        unpatches = [];
        changes.edits.clear();
        changes.names.clear();
    },

    settings: {
        apiUrl: {
            type: "string",
            label: "Bot API URL",
            default: "http://192.168.0.52:8080/api",
            description: "Your computer's IP with the bot running"
        }
    }
};
