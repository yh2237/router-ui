import type { Transport } from "../server/lib/types.js";
import { SshTransport } from "./ssh.js";
import { TelnetTransport } from "./telnet.js";

export type TransportType = "ssh" | "telnet";

export function createTransport(type: TransportType): Transport {
	switch (type) {
		case "ssh":
			return new SshTransport();
		case "telnet":
			return new TelnetTransport();
	}
}
