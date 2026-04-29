/**
 * Impersonation Bot Plugin
 * 
 * For KettuTweak / Vendetta / Bunny / Revenge
 * Uses standard @vendetta/* imports.
 * 
 * Install: https://cdn.jsdelivr.net/gh/0xAndrei/plugins@main/manifest.json
 */

import { findByStoreName } from "@vendetta/metro";
import { after, instead } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { showToast } from "@vendetta/ui/toasts";

const PLUGIN_ID = "impersonation-bot";
const log = (...args) => console.log(`[${PLUGIN_ID}]`, ...args);


const API_BASE = (storage && storage.apiUrl) || "http://192.168.0.52:8080/api";
const SYNC_INTERVAL = 4000;

/
const changes = {
    edits: new Map(),
    names: new Map(),
};
let currentUserId = null;
let unpatches = [];
let syncTimer = null;

// ==================== API SYNC ====================

async function syncChanges() {
    if (!currentUserId) {
        try {
            const UserStore = findByStoreName("UserStore");
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
            headers: { "Accept": "application/json" },
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
        const MessageStore = findByStoreName("MessageStore");
        if (!MessageStore) {
            log("MessageStore not found");
            return;
        }

        if (MessageStore.getMessage) {
            const unpatch = instead("getMessage", MessageStore, function(args, orig) {
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
            const unpatch = after("getMessages", MessageStore, (args, res) => {
                if (!res || !res._array || !res._array.length) return res;
                res._array = res._array.map((msg) => {
                    const edit = changes.edits.get(msg.id);
                    if (edit && !msg.__impersonationPatched) {
                        return {
                            ...msg,
                            content: edit,
                            editedTimestamp: Date.now(),
                            __impersonationPatched: true,
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
        const UserStore = findByStoreName("UserStore");
        if (UserStore && UserStore.getUser) {
            const unpatch = after("getUser", UserStore, (args, res) => {
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

        const GuildMemberStore = findByStoreName("GuildMemberStore");
        if (GuildMemberStore && GuildMemberStore.getMember) {
            const unpatch = after("getMember", GuildMemberStore, (args, res) => {
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
        for (const unpatch of unpatches) {
            try { unpatch && unpatch(); } catch (e) {}
        }
        unpatches = [];
        changes.edits.clear();
        changes.names.clear();
    },
};
