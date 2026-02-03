import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Switch } from "@components/Switch";
import { IS_MAC } from "@utils/constants";
import { classes } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { Forms, MediaEngineStore, React, UserStore, VoiceStateStore } from "@webpack/common";

import managedStyle from "./styles.css?managed";

const PanelButton = findComponentByCodeLazy(".GREEN,positionKeyStemOverride:");

let lastSelfMute: boolean | null = null;
let lastSelfDeaf: boolean | null = null;

type KeybindSetting = {
    key: string;
    code: string;
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    meta: boolean;
};

type KeybindValue = KeybindSetting | null;

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);
const KEY_LABEL_OVERRIDES: Record<string, string> = {
    " ": "Space",
    Spacebar: "Space",
    Escape: "Esc",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    PageUp: "Page Up",
    PageDown: "Page Down",
};

let activeKeybindRecorderStop: (() => void) | null = null;
let isRecordingKeybind = false;

function formatKeyName(key: string, code: string) {
    if (KEY_LABEL_OVERRIDES[key]) return KEY_LABEL_OVERRIDES[key];

    if (key === "Dead" || key === "Unidentified") {
        if (code.startsWith("Key")) return code.slice(3).toUpperCase();
        if (code.startsWith("Digit")) return code.slice(5);
        if (code.startsWith("Numpad")) return `Numpad ${code.slice(6)}`;
    }

    if (key.length === 1) return key.toUpperCase();

    return key;
}

function formatKeybind(keybind?: KeybindSetting | null) {
    if (!keybind) return "Not set";

    const parts: string[] = [];
    if (keybind.ctrl) parts.push("Ctrl");
    if (keybind.shift) parts.push("Shift");
    if (keybind.alt) parts.push(IS_MAC ? "Option" : "Alt");
    if (keybind.meta) parts.push(IS_MAC ? "Cmd" : "Meta");

    parts.push(formatKeyName(keybind.key, keybind.code));

    return parts.join("+");
}

function keybindFromEvent(event: KeyboardEvent): KeybindSetting | null {
    if (MODIFIER_KEYS.has(event.key)) return null;

    return {
        key: event.key,
        code: event.code,
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        alt: event.altKey,
        meta: event.metaKey
    };
}

function matchesKeybind(event: KeyboardEvent, keybind?: KeybindSetting | null) {
    if (!keybind) return false;

    const keyMatches = keybind.code ? event.code === keybind.code : event.key === keybind.key;
    if (!keyMatches) return false;

    return event.ctrlKey === keybind.ctrl
        && event.shiftKey === keybind.shift
        && event.altKey === keybind.alt
        && event.metaKey === keybind.meta;
}

function shouldIgnoreKeybindTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;
    if (target.closest("[contenteditable='true']")) return true;

    const tagName = target.tagName.toLowerCase();
    return tagName === "input" || tagName === "textarea" || tagName === "select";
}

function getSelfVoiceState() {
    const currentUserId = UserStore?.getCurrentUser?.()?.id;
    if (!currentUserId || !VoiceStateStore?.getVoiceStateForUser) return null;

    return VoiceStateStore.getVoiceStateForUser(currentUserId) ?? null;
}

function getDefaultMediaConnection() {
    const mediaEngine = MediaEngineStore?.getMediaEngine?.();
    if (!mediaEngine?.connections) return null;

    let fallbackConnection = null;
    for (const connection of mediaEngine.connections) {
        if (!fallbackConnection) fallbackConnection = connection;
        if (connection?.context === "default") return connection;
    }

    return fallbackConnection;
}

function setLocalMute(muted: boolean) {
    const connection = getDefaultMediaConnection();
    connection?.setSelfMute?.(muted);
}

function setLocalDeaf(deafened: boolean) {
    const connection = getDefaultMediaConnection();
    connection?.setSelfDeaf?.(deafened);
}

function syncFakeMute(nextFakeMute: boolean) {
    const voiceState = getSelfVoiceState();

    if (nextFakeMute) {
        lastSelfMute = voiceState?.selfMute ?? null;
        setLocalMute(false);
        return;
    }

    if (lastSelfMute != null) {
        setLocalMute(lastSelfMute);
        lastSelfMute = null;
        return;
    }

    if (voiceState) setLocalMute(!!voiceState.selfMute);
}

function syncFakeDeafen(nextFakeDeafen: boolean) {
    const voiceState = getSelfVoiceState();

    if (nextFakeDeafen) {
        lastSelfDeaf = voiceState?.selfDeaf ?? null;
        setLocalDeaf(false);
        return;
    }

    if (lastSelfDeaf != null) {
        setLocalDeaf(lastSelfDeaf);
        lastSelfDeaf = null;
        return;
    }

    if (voiceState) setLocalDeaf(!!voiceState.selfDeaf);
}

const settings = definePluginSettings({
    controls: {
        type: OptionType.COMPONENT,
        component: VoiceButtonSettings
    },
    fakeMute: {
        description: "random (mute) moved to profile panel",
        type: OptionType.BOOLEAN,
        default: false,
        hidden: true,
        onChange: next => syncFakeMute(next),
    },
    fakeDeafen: {
        description: "random (deafen) moved to profile panel",
        type: OptionType.BOOLEAN,
        default: false,
        hidden: true,
        onChange: next => syncFakeDeafen(next),
    },
    showFakeMuteButton: {
        description: "Show fake mute button",
        type: OptionType.BOOLEAN,
        default: true,
        hidden: true,
    },
    showFakeDeafenButton: {
        description: "Show fake deafen button",
        type: OptionType.BOOLEAN,
        default: true,
        hidden: true,
    },
    fakeMuteHotkey: {
        type: OptionType.CUSTOM,
        default: null as KeybindValue
    },
    fakeDeafenHotkey: {
        type: OptionType.CUSTOM,
        default: null as KeybindValue
    },
});

type PanelButtonProps = {
    nameplate?: unknown;
};

type KeybindRowProps = {
    actionLabel: string;
    description: string;
    enabled: boolean;
    onEnabledChange: (value: boolean) => void;
    hotkey: KeybindValue;
    onHotkeyChange: (value: KeybindValue) => void;
};

function KeybindRow({
    actionLabel,
    description,
    enabled,
    onEnabledChange,
    hotkey,
    onHotkeyChange,
}: KeybindRowProps) {
    const [isRecording, setIsRecording] = React.useState(false);
    const onChangeRef = React.useRef(onHotkeyChange);

    const stopRecording = React.useCallback(() => setIsRecording(false), []);

    React.useEffect(() => {
        onChangeRef.current = onHotkeyChange;
    }, [onHotkeyChange]);

    React.useEffect(() => {
        if (!isRecording) {
            if (activeKeybindRecorderStop === stopRecording) {
                activeKeybindRecorderStop = null;
            }
            isRecordingKeybind = activeKeybindRecorderStop != null;
            return;
        }

        if (activeKeybindRecorderStop && activeKeybindRecorderStop !== stopRecording) {
            activeKeybindRecorderStop();
        }
        activeKeybindRecorderStop = stopRecording;
        isRecordingKeybind = true;

        const handleKeyDown = (event: KeyboardEvent) => {
            event.preventDefault();
            event.stopPropagation();

            if (event.repeat) return;
            if (event.key === "Escape") {
                setIsRecording(false);
                return;
            }

            const keybind = keybindFromEvent(event);
            if (!keybind) return;

            onChangeRef.current(keybind);
            setIsRecording(false);
        };

        window.addEventListener("keydown", handleKeyDown, true);
        return () => {
            window.removeEventListener("keydown", handleKeyDown, true);
        };
    }, [isRecording, stopRecording]);

    const displayValue = isRecording
        ? "Recording..."
        : (hotkey ? formatKeybind(hotkey) : "Record Keybind");

    return (
        <div className="vc-fvo-keybind-item">
            <div className="vc-fvo-keybind-row">
                <button type="button" className="vc-fvo-keybind-action">
                    <span>{actionLabel}</span>
                    <svg
                        className="vc-fvo-keybind-caret"
                        aria-hidden="true"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                    >
                        <path
                            fill="currentColor"
                            d="M7 10a1 1 0 0 1 1.7-.7l3.3 3.3 3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1-.3-.7Z"
                        />
                    </svg>
                </button>
                <button
                    type="button"
                    className={classes(
                        "vc-fvo-keybind-display",
                        !hotkey && "vc-fvo-keybind-empty",
                        isRecording && "vc-fvo-keybind-recording"
                    )}
                    onClick={() => setIsRecording(recording => !recording)}
                >
                    {displayValue}
                </button>
                <Button
                    size="small"
                    variant="secondary"
                    onClick={() => setIsRecording(recording => !recording)}
                >
                    {isRecording ? "Listening..." : "Edit Keybind"}
                </Button>
                <button
                    type="button"
                    className="vc-fvo-keybind-clear"
                    onClick={() => onChangeRef.current(null)}
                    disabled={!hotkey}
                    aria-label="Clear keybind"
                >
                    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                        <path
                            fill="currentColor"
                            d="M9 3a1 1 0 0 0-1 1v1H5.5a1 1 0 0 0 0 2h.5v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7h.5a1 1 0 1 0 0-2H16V4a1 1 0 0 0-1-1H9Zm1 4a1 1 0 0 1 1 1v8a1 1 0 1 1-2 0V8a1 1 0 0 1 1-1Zm5 1a1 1 0 1 0-2 0v8a1 1 0 1 0 2 0V8Z"
                        />
                    </svg>
                </button>
                <div className="vc-fvo-keybind-toggle">
                    <Switch checked={enabled} onChange={onEnabledChange} />
                </div>
            </div>
            <Forms.FormText className="vc-fvo-keybind-description">{description}</Forms.FormText>
        </div>
    );
}

function VoiceButtonSettings() {
    const {
        showFakeMuteButton,
        showFakeDeafenButton,
        fakeMuteHotkey,
        fakeDeafenHotkey
    } = settings.use([
        "showFakeMuteButton",
        "showFakeDeafenButton",
        "fakeMuteHotkey",
        "fakeDeafenHotkey"
    ]);

    return (
        <Forms.FormSection className="vc-fvo-settings">
            <Forms.FormTitle>Fake Voice Buttons</Forms.FormTitle>
            <Forms.FormText>
                Control which buttons appear in your voice panel and set a hotkey
                to toggle each one on or off.
            </Forms.FormText>
            <Forms.FormDivider />
            <div className="vc-fvo-keybind-header">
                <div>Action</div>
                <div>Keybind</div>
            </div>
            <KeybindRow
                actionLabel="Toggle Fake Mute"
                description="Toggle your fake mute on or off."
                enabled={showFakeMuteButton}
                onEnabledChange={value => settings.store.showFakeMuteButton = value}
                hotkey={fakeMuteHotkey}
                onHotkeyChange={value => settings.store.fakeMuteHotkey = value}
            />
            <Forms.FormDivider />
            <KeybindRow
                actionLabel="Toggle Fake Deafen"
                description="Toggle your fake deafen on or off."
                enabled={showFakeDeafenButton}
                onEnabledChange={value => settings.store.showFakeDeafenButton = value}
                hotkey={fakeDeafenHotkey}
                onHotkeyChange={value => settings.store.fakeDeafenHotkey = value}
            />
        </Forms.FormSection>
    );
}

function FakeVoiceButtons(props: PanelButtonProps) {
    const {
        fakeMute,
        fakeDeafen,
        showFakeMuteButton,
        showFakeDeafenButton
    } = settings.use([
        "fakeMute",
        "fakeDeafen",
        "showFakeMuteButton",
        "showFakeDeafenButton"
    ]);

    const FakeMuteIcon = () => (
        <svg width="20" height="20" viewBox="0 0 24 24">
            <path
                fill={fakeMute ? "currentColor" : "var(--status-danger)"}
                d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 14 0h-2Zm-5 7v3h2v-3a9 9 0 0 0 8-8h-2a7 7 0 0 1-14 0H4a9 9 0 0 0 8 8Z"
            />
        </svg>
    );

    const FakeDeafenIcon = () => (
        <svg width="20" height="20" viewBox="0 0 24 24">
            <path
                fill={fakeDeafen ? "currentColor" : "var(--status-danger)"}
                d="M12 1C6.48 1 2 5.48 2 11v7c0 1.66 1.34 3 3 3h3v-8H4v-2a8 8 0 0 1 16 0v2h-4v8h3c1.66 0 3-1.34 3-3v-7c0-5.52-4.48-10-10-10Z"
            />
        </svg>
    );

    return (
        <>
            {showFakeMuteButton && (
                <PanelButton
                    tooltipText={fakeMute ? "Fake Mute: On" : "Fake Mute: Off"}
                    icon={FakeMuteIcon}
                    role="switch"
                    aria-checked={fakeMute}
                    redGlow={!fakeMute}
                    plated={props?.nameplate != null}
                    onClick={() => {
                        const nextFakeMute = !fakeMute;
                        settings.store.fakeMute = nextFakeMute;
                        syncFakeMute(nextFakeMute);
                    }}
                />
            )}
            {showFakeDeafenButton && (
                <PanelButton
                    tooltipText={fakeDeafen ? "Fake Deafen: On" : "Fake Deafen: Off"}
                    icon={FakeDeafenIcon}
                    role="switch"
                    aria-checked={fakeDeafen}
                    redGlow={!fakeDeafen}
                    plated={props?.nameplate != null}
                    onClick={() => {
                        const nextFakeDeafen = !fakeDeafen;
                        settings.store.fakeDeafen = nextFakeDeafen;
                        syncFakeDeafen(nextFakeDeafen);
                    }}
                />
            )}
        </>
    );
}

let hotkeyListenerActive = false;

function handleHotkeys(event: KeyboardEvent) {
    if (event.defaultPrevented || event.repeat || isRecordingKeybind) return;
    if (shouldIgnoreKeybindTarget(event.target)) return;

    const { fakeMuteHotkey, fakeDeafenHotkey } = settings.store;

    let handled = false;
    if (matchesKeybind(event, fakeMuteHotkey)) {
        const next = !settings.store.fakeMute;
        settings.store.fakeMute = next;
        syncFakeMute(next);
        handled = true;
    }

    if (matchesKeybind(event, fakeDeafenHotkey)) {
        const next = !settings.store.fakeDeafen;
        settings.store.fakeDeafen = next;
        syncFakeDeafen(next);
        handled = true;
    }

    if (handled) {
        event.preventDefault();
        event.stopPropagation();
    }
}

function startHotkeyListener() {
    if (hotkeyListenerActive) return;
    window.addEventListener("keydown", handleHotkeys, true);
    hotkeyListenerActive = true;
}

function stopHotkeyListener() {
    if (!hotkeyListenerActive) return;
    window.removeEventListener("keydown", handleHotkeys, true);
    hotkeyListenerActive = false;
    activeKeybindRecorderStop = null;
    isRecordingKeybind = false;
}

export default definePlugin({
    name: "Fake Voice Options",
    description: "fake mute/deafen",
    authors: [{
        name: "m7i1",
        id: 741416289423065088n
    }],
    settings,
    managedStyle,
    start() {
        startHotkeyListener();
    },
    stop() {
        stopHotkeyListener();
    },
    patches: [
        {
            find: "#{intl::ACCOUNT_SPEAKING_WHILE_MUTED}",
            replacement: {
                match: /children:\[(?=.{0,25}?accountContainerRef)/,
                replace: "children:[$self.FakeVoiceButtons(arguments[0]),"
            }
        },
        {
            find: "e.setSelfMute(n)",
            replacement: [{
                match: /e\.setSelfMute\(n\),/g,
                replace: "e.setSelfMute($self.settings.store.fakeMute?false:n),"
            },
            {
                match: /e\.setSelfDeaf\(t\.deaf\)/g,
                replace: "e.setSelfDeaf($self.settings.store.fakeDeafen?false:t.deaf)"
            }]
        },
    ],
    FakeVoiceButtons: ErrorBoundary.wrap(FakeVoiceButtons, { noop: true }),
});
