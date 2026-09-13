import path from "node:path";

const HOST_TOOL_ENVIRONMENT_KEYS = Object.freeze([
  "COMSPEC",
  "HOME",
  "LOCALAPPDATA",
  "PATH",
  "PATHEXT",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "WINDIR",
]);

const NETWORK_ENVIRONMENT_KEYS = Object.freeze([
  "ALL_PROXY",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "NO_PROXY",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "all_proxy",
  "https_proxy",
  "http_proxy",
  "no_proxy",
]);

export function pinnedGoBuildEnvironment({
  baseEnvironment = process.env,
  goToolchain,
  packageRoot,
  overrides = {} as any,
}) {
  const stateRoot = path.join(packageRoot, ".state", "k6-release-go");
  return Object.freeze({
    ...requiredHostEnvironment(baseEnvironment),
    CGO_ENABLED: "0",
    GOCACHE: path.join(stateRoot, "build-cache"),
    GOENV: "off",
    GOEXPERIMENT: "",
    GOFLAGS: "-modcacherw",
    GOMODCACHE: path.join(stateRoot, "module-cache"),
    GOOS: "",
    GOARCH: "",
    GOAMD64: "v1",
    GOARM64: "v8.0",
    GOPATH: path.join(stateRoot, "gopath"),
    GOTOOLCHAIN: goToolchain,
    GOWORK: "off",
    LC_ALL: "C",
    SOURCE_DATE_EPOCH: "1785196800",
    TZ: "UTC",
    ...overrides,
  });
}

function requiredHostEnvironment(baseEnvironment) {
  return Object.fromEntries(
    [...HOST_TOOL_ENVIRONMENT_KEYS, ...NETWORK_ENVIRONMENT_KEYS].flatMap(
      (key) => {
        const value = baseEnvironment[key];
        return typeof value === "string" && value.length > 0
          ? [[key, value]]
          : [];
      },
    ),
  );
}
