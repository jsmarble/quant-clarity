export interface SourcePrefixes {
  primary: string;
  rotation: string | null;
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) =>
    /^(0|[1-9][0-9]{0,2})$/u.test(part) ? Number(part) : -1,
  );
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

function ipv6Groups(address: string): number[] | null {
  if (address.includes("%") || address.split("::").length > 2) return null;
  let normalized = address.toLowerCase();
  const lastColon = normalized.lastIndexOf(":");
  const embeddedIpv4 = parseIpv4(normalized.slice(lastColon + 1));
  if (embeddedIpv4 !== null) {
    const first = embeddedIpv4[0] ?? -1;
    const second = embeddedIpv4[1] ?? -1;
    const third = embeddedIpv4[2] ?? -1;
    const fourth = embeddedIpv4[3] ?? -1;
    const high = (first << 8) | second;
    const low = (third << 8) | fourth;
    normalized = `${normalized.slice(0, lastColon)}:${high.toString(16)}:${low.toString(16)}`;
  }

  const [leftText, rightText] = normalized.split("::") as [string, string?];
  const parseSide = (text: string | undefined): number[] | null => {
    if (text === undefined || text === "") return [];
    const values = text
      .split(":")
      .map((part) =>
        /^[0-9a-f]{1,4}$/u.test(part) ? Number.parseInt(part, 16) : -1,
      );
    return values.every((value) => value >= 0 && value <= 0xffff)
      ? values
      : null;
  };
  const left = parseSide(leftText);
  const right = parseSide(rightText);
  if (left === null || right === null) return null;
  if (normalized.includes("::")) {
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    return [...left, ...Array<number>(missing).fill(0), ...right];
  }
  return left.length === 8 ? left : null;
}

export function sourcePrefixes(address: string): SourcePrefixes | null {
  const ipv4 = parseIpv4(address);
  if (ipv4 !== null)
    return { primary: `v4:${ipv4.join(".")}/32`, rotation: null };
  const groups = ipv6Groups(address);
  if (groups?.length !== 8) return null;
  const mappedIpv4 =
    groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff
      ? [
          (groups[6] ?? 0) >>> 8,
          (groups[6] ?? 0) & 0xff,
          (groups[7] ?? 0) >>> 8,
          (groups[7] ?? 0) & 0xff,
        ]
      : null;
  if (mappedIpv4 !== null)
    return { primary: `v4:${mappedIpv4.join(".")}/32`, rotation: null };
  const format = (count: number) =>
    groups
      .slice(0, count)
      .map((group) => group.toString(16).padStart(4, "0"))
      .join(":");
  return {
    primary: `v6:${format(4)}/64`,
    rotation: `v6:${format(3)}/48`,
  };
}
