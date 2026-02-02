import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { OptionType } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { MediaEngineStore, React, UserStore, VoiceStateStore } from "@webpack/common";

const PanelButton = findComponentByCodeLazy(".GREEN,positionKeyStemOverride:");

let lastSelfMute: boolean | null = null;
let lastSelfDeaf: boolean | null = null;

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
    fakeMute: {
        description: "random (mute) moved to profile panel",
        type: OptionType.BOOLEAN,
        default: false,
        onChange: next => syncFakeMute(next),
    },
    fakeDeafen: {
        description: "random (deafen) moved to profile panel",
        type: OptionType.BOOLEAN,
        default: false,
        onChange: next => syncFakeDeafen(next),
    },
});

type PanelButtonProps = {
    nameplate?: unknown;
};

function FakeVoiceButtons(props: PanelButtonProps) {
    const { fakeMute, fakeDeafen } = settings.use(["fakeMute", "fakeDeafen"]);

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
            <PanelButton
                tooltipText={fakeMute ? "Fake Mute: On" : "Fake Mute: Off"}
                icon={FakeMuteIcon}
                role="switch"
                aria-checked={fakeMute}
                redGlow={!fakeMute}
                plated={props?.nameplate != null}
                onClick={() => {
                    settings.store.fakeMute = !fakeMute;
                }}
            />
            <PanelButton
                tooltipText={fakeDeafen ? "Fake Deafen: On" : "Fake Deafen: Off"}
                icon={FakeDeafenIcon}
                role="switch"
                aria-checked={fakeDeafen}
                redGlow={!fakeDeafen}
                plated={props?.nameplate != null}
                onClick={() => {
                    settings.store.fakeDeafen = !fakeDeafen;
                }}
            />
        </>
    );
}

export default definePlugin({
    name: "Fake Voice Options",
    description: "fake mute/deafen",
    authors: [{
        name: "m7i1",
        id: 741416289423065088n
    }],
    settings,
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
