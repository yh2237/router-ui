import assert from "node:assert/strict";
import test from "node:test";
import {
    buildTimeCommands,
    diffConfig,
    redactConfigLine,
    SettingsValidationError,
    type TimeSettingsInput,
} from "./settings.js";

const baseInput: TimeSettingsInput = {
    timezoneMode: "unchanged",
    timezoneOffset: "",
    date: "",
    time: "",
    ntpServer: "",
    ntpSyslog: false,
    ntpSourceMode: "unchanged",
    ntpSourceAddress: "",
    syncNtp: false,
};

test("buildTimeCommands creates only validated YAMAHA commands", () => {
    assert.deepEqual(
        buildTimeCommands({
            ...baseInput,
            timezoneMode: "custom",
            timezoneOffset: "+09:30",
            date: "2026-07-26",
            time: "14:05:09",
            ntpServer: "ntp.example.jp",
            ntpSyslog: true,
            ntpSourceMode: "set",
            ntpSourceAddress: "192.0.2.10",
            syncNtp: true,
        }),
        [
            "timezone +09:30",
            "date 2026-07-26",
            "time 14:05:09",
            "ntp local address 192.0.2.10",
            "ntpdate ntp.example.jp syslog",
        ],
    );
});

test("buildTimeCommands supports removing an NTP source address", () => {
    assert.deepEqual(
        buildTimeCommands({ ...baseInput, timezoneMode: "utc", ntpSourceMode: "remove" }),
        ["timezone utc", "no ntp local address"],
    );
});

test("buildTimeCommands rejects an empty change set", () => {
    assert.throws(
        () => buildTimeCommands(baseInput),
        (error) => error instanceof SettingsValidationError
            && error.issues.includes("変更する項目を1つ以上指定してください。"),
    );
});

test("buildTimeCommands rejects invalid and injectable input", () => {
    assert.throws(
        () => buildTimeCommands({
            ...baseInput,
            timezoneMode: "custom",
            timezoneOffset: "+12:00",
            date: "2026-02-30",
            time: "24:00:00",
            ntpServer: "ntp.example.jp; save",
            syncNtp: true,
        }),
        (error) => error instanceof SettingsValidationError && error.issues.length === 4,
    );
});

test("diffConfig preserves order and duplicate line counts", () => {
    assert.deepEqual(
        diffConfig("a\nb\nb\nc\n", "a\nb\nc\nd\nd\n"),
        { added: ["d", "d"], removed: ["b"] },
    );
});

test("redactConfigLine hides router credentials", () => {
    assert.equal(redactConfigLine("pp auth myname user@example.jp secret"), "pp auth myname user@example.jp ••••••••");
    assert.equal(
        redactConfigLine("ipsec ike pre-shared-key 1 text vpn-secret"),
        "ipsec ike pre-shared-key 1 text ••••••••",
    );
    assert.equal(
        redactConfigLine("snmp host 192.0.2.10 monitoring"),
        "snmp host 192.0.2.10 ••••••••",
    );
    assert.equal(
        redactConfigLine("snmp trap host 192.0.2.20 trap-secret"),
        "snmp trap host 192.0.2.20 ••••••••",
    );
    assert.equal(redactConfigLine("snmp host none"), "snmp host none");
});
