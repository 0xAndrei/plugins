

const { findByStoreName, findByProps } = kettu.metro;
const { after, instead } = kettu.patcher;
const { showToast } = kettu.ui?.toasts || { showToast: (msg) => console.log(msg) };
const { storage } = kettu;

const PLUGIN_ID = "impersonation-bot";
const log = console.log.bind(console, `[${PLUGIN_ID}]`);

const API_BASE = storage?.apiUrl || "http://192.168.0.52:8080/api";
const SYNC_INTERVAL = 4000;

const changes = {
    edits: new Map(),     
    names: new Map(),    
};
let currentUserId = null;
let unpatches = [];
let syncTimer = null;
let isConnected = false;


async function syncChanges() {
    if (!currentUserId) {
        try {
            const UserStore = findByStoreName("UserStore");
            const user = UserStore?.getCurrentUser?.();
            if (user?.id) {
                currentUserId = user.id;
                log("Got user ID:", currentUserId);
            }
        } catch (e) {}
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/changes/${currentUserId}`, {
            method: "GET",
            headers: { "Accept": "application/json" }
        });

        if (!response.ok) {
            if (isConnected) {
                isConnected = false;
                log("API disconnected");
            }
            return;
        }

        const data = await response.json();
        isConnected = true;

        let editCount = 0;
        let nameCount = 0;

        if (data.message_edits) {
            for (const edit of data.message_edits) {
                changes.edits.set(edit.message_id, edit.new_content);
                editCount++;
            }
        }
        if (data.name_changes) {
            for (const nc of data.name_changes) {
                changes.names.set(nc.target_user_id, nc.new_name);
                nameCount++;
            }
        }

        if (editCount > 0 || nameCount > 0) {
            log(`Synced ${editCount} edits, ${nameCount} names`);
        }
    } catch (e) {
        if (isConnected) {
            isConnected = false;
            log("API error:", e.message || e);
        }
    }
}


function patchMessages() {
    try {
        const MessageStore = findByStoreName("MessageStore");
        
        if (MessageStore?.getMessage) {
            const unpatch = instead("getMessage", MessageStore, function(args, orig) {
                const msg = orig.apply(this, args);
                if (!msg?.id) return msg;
                
                const edit = changes.edits.get(msg.id);
                if (edit) {
                    // Return modified message without mutating original store
                    const modified = Object.create(Object.getPrototypeOf(msg));
                    Object.assign(modified, msg);
                    modified.content = edit;
                    modified.editedTimestamp = Date.now();
                    modified.__impersonationEdited = true;
                    return modified;
                }
                return msg;
            });
            unpatches.push(unpatch);
            log("Patched MessageStore.getMessage");
        }

        if (MessageStore?.getMessages) {
            const unpatch = after("getMessages", MessageStore, (args, res) => {
                if (!res?._array?.length) return res;
                
                res._array = res._array.map(msg => {
                    const edit = changes.edits.get(msg.id);
                    if (edit && !msg.__impersonationPatched) {
                        const modified = { ...msg };
                        modified.content = edit;
                        modified.editedTimestamp = Date.now();
                        modified.__impersonationPatched = true;
                        return modified;
                    }
                    return msg;
                });
                return res;
            });
            unpatches.push(unpatch);
            log("Patched MessageStore.getMessages");
        }

    } catch (e) {
        log("Message patch error:", e);
    }
}


function patchNames() {
    try {
        const UserStore = findByStoreName("UserStore");
        
        if (UserStore?.getUser) {
            const unpatch = after("getUser", UserStore, (args, res) => {
                if (!res?.id) return res;
                const name = changes.names.get(res.id);
                if (name) {
                    return {
                        ...res,
                        username: name,
                        globalName: name,
                        displayName: name,
                        __impersonationRenamed: true
                    };
                }
                return res;
            });
            unpatches.push(unpatch);
            log("Patched UserStore.getUser");
        }

        const GuildMemberStore = findByStoreName("GuildMemberStore");
        if (GuildMemberStore?.getMember) {
            const unpatch = after("getMember", GuildMemberStore, (args, res) => {
                if (!res?.userId) return res;
                const name = changes.names.get(res.userId);
                if (name) {
                    return {
                        ...res,
                        nick: name,
                        displayName: name,
                        __impersonationRenamed: true
                    };
                }
                return res;
            });
            unpatches.push(unpatch);
            log("Patched GuildMemberStore.getMember");
        }

    } catch (e) {
        log("Name patch error:", e);
    }
}


function patchTimestamp() {
    try {
        const Timestamp = findByProps("MessageTimestamp", "default") || findByProps("renderTimestamp");
        
        if (Timestamp?.default) {
            const unpatch = after("default", Timestamp, (args, res) => {
                const message = args[0]?.message;
                if ((message?.__impersonationEdited || message?.__impersonationPatched) && res?.props) {
                }
                return res;
            });
            unpatches.push(unpatch);
        }

    } catch (e) {
        log("Timestamp patch error:", e);
    }
}


export default {
    onLoad() {
        log("Loading Impersonation Bot plugin...");
        log("API:", API_BASE);

        setTimeout(() => {
            patchMessages();
            patchNames();
            patchTimestamp();

            syncChanges();

            syncTimer = setInterval(syncChanges, SYNC_INTERVAL);

            showToast?.("Impersonation Bot active");
            log("Ready - syncing every", SYNC_INTERVAL + "ms");
        }, 3000);
    },

    onUnload() {
        log("Unloading...");
        if (syncTimer) clearInterval(syncTimer);
        unpatches.forEach(u => {
            try { u?.(); } catch (e) {}
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
            description: "The IP of the computer running the bot"
        }
    },

    // Kettu manifest
    manifest: {
        name: "Impersonation Bot",
        description: "Local message edits, name changes, and impersonations via bot API",
        author: "Impersonation Bot",
        version: "1.0.0",
        color: "#5865f2"
    }
};
