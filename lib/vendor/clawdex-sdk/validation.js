import { isValidIotaAddress, isValidIotaObjectId, normalizeIotaAddress } from "@iota/iota-sdk/utils";
const MAX_U64 = (1n << 64n) - 1n;
const MAX_U8 = 255;
const MOVE_TYPE_TAG_PACKAGE_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const MOVE_PRIMITIVE_TYPE_NAMES = new Set(["bool", "u8", "u16", "u32", "u64", "u128", "u256", "address", "signer"]);
const MAX_MOVE_TYPE_TAG_LENGTH = 1024;
const MAX_MOVE_TYPE_TAG_DEPTH = 16;
const utf8Encoder = new TextEncoder();
const ZERO_IOTA_ADDRESS = `0x${"0".repeat(64)}`;
export function assertValidIotaAddress(input, fieldName) {
    if (!isValidIotaAddress(input)) {
        throw new Error(`invalid_${fieldName}`);
    }
    return normalizeIotaAddress(input);
}
export function assertDistinctNonZeroAddresses(firstInput, firstFieldName, secondInput, secondFieldName, errorFieldName) {
    const first = assertValidIotaAddress(firstInput, firstFieldName);
    const second = assertValidIotaAddress(secondInput, secondFieldName);
    if (first === ZERO_IOTA_ADDRESS || second === ZERO_IOTA_ADDRESS || first === second) {
        throw new Error(`invalid_${errorFieldName}`);
    }
    return { first, second };
}
export function assertValidIotaObjectId(input, fieldName) {
    if (!isValidIotaObjectId(input)) {
        throw new Error(`invalid_${fieldName}`);
    }
    return normalizeIotaAddress(input);
}
export function assertValidMoveTypeTag(input, fieldName) {
    if (typeof input !== "string") {
        throw new Error(`invalid_${fieldName}`);
    }
    const normalized = input.trim();
    if (!normalized || /\s/.test(normalized) || normalized.length > MAX_MOVE_TYPE_TAG_LENGTH) {
        throw new Error(`invalid_${fieldName}`);
    }
    const parser = createMoveTypeTagParser(normalized);
    const canonical = parser.parseTypeTag(0);
    if (!canonical || parser.position !== normalized.length) {
        throw new Error(`invalid_${fieldName}`);
    }
    return canonical;
}
export function assertPositiveAmount(input, fieldName) {
    if (typeof input !== "bigint") {
        throw new Error(`invalid_${fieldName}`);
    }
    if (input <= 0n || input > MAX_U64) {
        throw new Error(`invalid_${fieldName}`);
    }
    return input.toString();
}
export function isValidIotaAddressInput(input) {
    return isValidIotaAddress(input);
}
export function isValidIotaObjectIdInput(input) {
    return isValidIotaObjectId(input);
}
export function assertByteVectorInput(input, fieldName, minLength = 1, maxLength = Number.MAX_SAFE_INTEGER) {
    const bytes = input instanceof Uint8Array ? Array.from(input) : Array.isArray(input) ? [...input] : null;
    if (!bytes || bytes.length < minLength || bytes.length > maxLength) {
        throw new Error(`invalid_${fieldName}`);
    }
    for (const value of bytes) {
        if (!Number.isInteger(value) || !Number.isFinite(value) || value < 0 || value > MAX_U8) {
            throw new Error(`invalid_${fieldName}`);
        }
    }
    return bytes;
}
export function assertBoundedUtf8String(input, fieldName, maxLength) {
    if (typeof input !== "string") {
        throw new Error(`invalid_${fieldName}`);
    }
    const normalized = input.trim();
    if (!normalized) {
        throw new Error(`invalid_${fieldName}`);
    }
    const byteLength = utf8Encoder.encode(normalized).byteLength;
    if (byteLength === 0 || byteLength > maxLength) {
        throw new Error(`invalid_${fieldName}`);
    }
    return normalized;
}
export function assertCanonicalProtocolString(input, fieldName, maxLength) {
    if (typeof input !== "string") {
        throw new Error(`invalid_${fieldName}`);
    }
    if (input.length === 0 || input.trim().length === 0) {
        throw new Error(`invalid_${fieldName}`);
    }
    if (input !== input.trim()) {
        throw new Error(`invalid_${fieldName}`);
    }
    const byteLength = utf8Encoder.encode(input).byteLength;
    if (byteLength === 0 || byteLength > maxLength) {
        throw new Error(`invalid_${fieldName}`);
    }
    return input;
}
function createMoveTypeTagParser(input) {
    let position = 0;
    function consume(expected) {
        if (input.startsWith(expected, position)) {
            position += expected.length;
            return true;
        }
        return false;
    }
    function parseIdentifier() {
        const remainder = input.slice(position);
        const match = remainder.match(/^[A-Za-z_][A-Za-z0-9_]*/);
        if (!match) {
            return null;
        }
        position += match[0].length;
        return match[0];
    }
    function parsePackageId() {
        const remainder = input.slice(position);
        const match = remainder.match(/^0x[0-9a-fA-F]{64}/);
        if (!match || !MOVE_TYPE_TAG_PACKAGE_PATTERN.test(match[0]) || !isValidIotaObjectId(match[0])) {
            return null;
        }
        position += match[0].length;
        return normalizeIotaAddress(match[0]);
    }
    function parseGenericArguments(depth) {
        if (!consume("<")) {
            return [];
        }
        const args = [];
        do {
            const argument = parseTypeTag(depth + 1);
            if (!argument) {
                return null;
            }
            args.push(argument);
        } while (consume(","));
        if (!consume(">")) {
            return null;
        }
        return args;
    }
    function parseVectorType(depth) {
        if (!input.startsWith("vector<", position)) {
            return null;
        }
        position += "vector".length;
        const args = parseGenericArguments(depth);
        if (!args || args.length !== 1) {
            return null;
        }
        return `vector<${args[0]}>`;
    }
    function parsePrimitiveType() {
        for (const primitive of MOVE_PRIMITIVE_TYPE_NAMES) {
            if (!input.startsWith(primitive, position)) {
                continue;
            }
            const next = input.charAt(position + primitive.length);
            if (next && /[A-Za-z0-9_]/.test(next)) {
                continue;
            }
            position += primitive.length;
            return primitive;
        }
        return null;
    }
    function parseStructTag(depth) {
        const rawPackageId = parsePackageId();
        if (!rawPackageId || !consume("::")) {
            return null;
        }
        const moduleName = parseIdentifier();
        if (!moduleName || !consume("::")) {
            return null;
        }
        const structName = parseIdentifier();
        if (!structName) {
            return null;
        }
        const genericArgs = parseGenericArguments(depth);
        if (genericArgs === null) {
            return null;
        }
        return genericArgs.length > 0
            ? `${rawPackageId}::${moduleName}::${structName}<${genericArgs.join(",")}>`
            : `${rawPackageId}::${moduleName}::${structName}`;
    }
    function parseTypeTag(depth) {
        if (depth > MAX_MOVE_TYPE_TAG_DEPTH) {
            return null;
        }
        return parseVectorType(depth) ?? parsePrimitiveType() ?? parseStructTag(depth);
    }
    return {
        parseTypeTag,
        get position() {
            return position;
        }
    };
}
//# sourceMappingURL=validation.js.map