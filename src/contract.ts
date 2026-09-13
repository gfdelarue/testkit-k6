import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { inspectSourceArchive, parseGoSumCatalog } from "./source-archive.ts";
import { PINNED_GO_MODULE_ACQUISITION_TRANSPORT_POLICY } from "./materials.ts";
import { runManagedCommand } from "./command.ts";

export const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const PACKAGE_REPOSITORY = Object.freeze({
  type: "git",
  url: "https://github.com/gfdelarue/testkit-k6.git",
});

export const K6_RELEASE = Object.freeze({
  expectedExecutables: Object.freeze({
    "darwin-arm64":
      "9047926417cb139eaaf5620f81ab97f364644e8f44cbca04eeb9d56fa8f8b415",
    "darwin-x64":
      "55fef83f9778299369eba4657f6a6fa7fd76575632d8b0b37b5f532468253939",
    "linux-arm64":
      "f06b98d11bcbbc5ac1b039c401fedef9dc8cfe5c83902e5bbfd6536d1e017d3a",
    "linux-x64":
      "105e7e1959ba529c25fe13d3ac1c77b4bce74595064a1a8c1722af5e20ca859f",
    "win32-x64":
      "6beab40161baa861f97f5178e13b1b7e05b96ad00f22c8ee5fda42dff70125dd",
  }),
  k6Version: "1.7.1",
  packageVersion: "1.0.0",
});

export const K6_BUILD_CONTRACT = Object.freeze({
  generatedAt: "2026-03-30T10:42:38.000Z",
  goToolchain: "go1.25.10",
  k6: Object.freeze({
    commit: "9f82e6f1fc5e806b93459b6189fbd81e4fd6b2ee",
    module: "go.k6.io/k6",
    repository: "https://github.com/grafana/k6",
    version: "v1.7.1",
  }),
  sourceArchive: "source/testkit-k6-v1.7.1-source.tar.gz",
  sourceGenerationTarget: Object.freeze({ goarch: "amd64", goos: "linux" }),
  sourcePackage: "@gfdelarue/testkit-engine-k6-source",
  sourceRoot: "testkit-k6-v1.7.1-source",
  xk6: Object.freeze({
    commit: "3573dee6ff2056008d56e24e0f643c183e5c8d61",
    module: "go.k6.io/xk6/cmd/xk6",
    repository: "https://github.com/grafana/xk6",
    version: "v1.4.2",
  }),
  xk6Checksums: Object.freeze({
    goModSum: "h1:zsGlKo4f47zcHQJe2n9llasm3UzR++ybxwXoOMuinlo=",
    moduleSum: "h1:Q5/b5DHqIZIGXCVNxzz/uTFtK25rH5gGYcOKYUZ10DA=",
  }),
  extensions: Object.freeze([
    Object.freeze({
      commit: "b071de0bdb55c5aaac09d32bee6e8e8c3b1e1f6f",
      license: "Apache-2.0",
      licenseFile: "licenses/xk6-sql-Apache-2.0.txt",
      module: "github.com/grafana/xk6-sql",
      repository: "https://github.com/grafana/xk6-sql",
      version: "v1.0.6",
    }),
    Object.freeze({
      commit: "48ed24bac976ec9c0e1fb1667616ed6277323805",
      license: "AGPL-3.0-only",
      licenseFile: "licenses/xk6-sql-driver-postgres-AGPL-3.0.txt",
      module: "github.com/grafana/xk6-sql-driver-postgres",
      repository: "https://github.com/grafana/xk6-sql-driver-postgres",
      version: "v0.1.2",
    }),
  ]),
});

export const K6_GO_BUILD_ARGUMENTS = Object.freeze([
  "build",
  "-mod=vendor",
  "-trimpath",
  "-buildvcs=false",
  "-ldflags=-s -w -buildid=",
]);

export const K6_PLATFORM_TARGETS = Object.freeze([
  target("darwin", "arm64", "arm64", "k6", "macOS arm64"),
  target("darwin", "x64", "amd64", "k6", "macOS x64"),
  target("linux", "arm64", "arm64", "k6", "Linux arm64"),
  target("linux", "x64", "amd64", "k6", "Linux x64"),
  target("win32", "x64", "amd64", "k6.exe", "Windows x64", "windows"),
]);

export const K6_PACKAGE_NAMES = Object.freeze([
  K6_BUILD_CONTRACT.sourcePackage,
  ...K6_PLATFORM_TARGETS.map((target_) => target_.packageName),
]);

export const K6_EMBEDDED_GO_METADATA_TIMEOUT_MS = 2 * 60 * 1_000;

const REQUIRED_SOURCE_ENTRIES = Object.freeze([
  "BUILD.md",
  "go.mod",
  "go.sum",
  "main.go",
  "vendor/modules.txt",
  "vendor/go.k6.io/k6/LICENSE.md",
  "vendor/github.com/grafana/xk6-sql/LICENSE",
  "vendor/github.com/grafana/xk6-sql-driver-postgres/LICENSE",
]);

export function committedSourceManifestPath(repoRoot = REPOSITORY_ROOT) {
  return path.join(path.resolve(repoRoot), "source-manifest.json");
}

export function packagesRoot(repoRoot = REPOSITORY_ROOT) {
  return path.join(path.resolve(repoRoot), ".state", "packages");
}

export function tarballsRoot(repoRoot = REPOSITORY_ROOT) {
  return path.join(path.resolve(repoRoot), ".state", "tarballs");
}

export function sourcePackageRoot(repoRoot = REPOSITORY_ROOT) {
  return path.join(packagesRoot(repoRoot), "testkit-engine-k6-source");
}

export function targetPackageRoot(repoRoot, target_) {
  return path.join(packagesRoot(repoRoot), target_.packageDirectory);
}

export function packageRoots(repoRoot = REPOSITORY_ROOT) {
  return Object.freeze([
    Object.freeze({
      name: K6_BUILD_CONTRACT.sourcePackage,
      root: sourcePackageRoot(repoRoot),
    }),
    ...K6_PLATFORM_TARGETS.map((target_) =>
      Object.freeze({
        name: target_.packageName,
        root: targetPackageRoot(repoRoot, target_),
      }),
    ),
  ]);
}

export function createSourcePackageManifest() {
  return {
    name: K6_BUILD_CONTRACT.sourcePackage,
    version: K6_RELEASE.packageVersion,
    description: `Build-source materials for Testkit's custom k6 ${K6_RELEASE.k6Version} executable`,
    repository: PACKAGE_REPOSITORY,
    publishConfig: { access: "public" },
    license: "SEE LICENSE IN licenses/k6-AGPL-3.0.txt",
    testkit: { k6Version: K6_RELEASE.k6Version },
    exports: {
      "./archive": `./${K6_BUILD_CONTRACT.sourceArchive}`,
      "./manifest": "./source-manifest.json",
      "./source": "./SOURCE.md",
      "./package.json": "./package.json",
    },
    files: ["licenses/", "source/", "source-manifest.json", "SOURCE.md"],
  };
}

export function createPlatformPackageManifest(target_) {
  return {
    name: target_.packageName,
    version: K6_RELEASE.packageVersion,
    description: `Testkit's custom k6 ${K6_RELEASE.k6Version} executable for ${target_.label}`,
    repository: PACKAGE_REPOSITORY,
    os: [target_.platform],
    cpu: [target_.architecture],
    publishConfig: { access: "public" },
    license: "SEE LICENSE IN licenses/k6-AGPL-3.0.txt",
    testkit: { k6Version: K6_RELEASE.k6Version },
    dependencies: {
      [K6_BUILD_CONTRACT.sourcePackage]: K6_RELEASE.packageVersion,
    },
    exports: {
      "./binary": `./bin/${target_.executable}`,
      "./source": "./SOURCE.md",
      "./package.json": "./package.json",
    },
    files: ["bin/", "metadata/", "licenses/", "SOURCE.md"],
  };
}

export function createPackageReadme(manifest) {
  return `# ${manifest.name}

${manifest.description}. Built and published from
${PACKAGE_REPOSITORY.url.replace(/\.git$/u, "")} at version ${manifest.version}.

Testkit installs this package as an exact optional dependency and runs the
executable directly. It is not meant to be installed by hand or placed on PATH.

k6 is licensed under AGPL-3.0; see \`licenses/\` and \`SOURCE.md\` for the
licence texts and the corresponding source.
`;
}

export function writePackageManifests(repoRoot = REPOSITORY_ROOT) {
  const manifests = [
    {
      manifest: createSourcePackageManifest(),
      root: sourcePackageRoot(repoRoot),
    },
    ...K6_PLATFORM_TARGETS.map((target_) => ({
      manifest: createPlatformPackageManifest(target_),
      root: targetPackageRoot(repoRoot, target_),
    })),
  ];
  for (const { manifest, root } of manifests) {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      path.join(root, "package.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(root, "README.md"),
      createPackageReadme(manifest),
    );
  }
}

export async function verifyK6ReleaseMaterials(repoRoot, options: any = {}) {
  const normalizedRoot = path.resolve(repoRoot);
  const sourcePackageRoot_ = sourcePackageRoot(normalizedRoot);
  const sourcePackage = readJson(
    path.join(sourcePackageRoot_, "package.json"),
    "k6 source package",
  );
  assertDeepExact(
    sourcePackage,
    createSourcePackageManifest(),
    "k6 source package manifest",
  );
  const sourceManifest = readJson(
    path.join(sourcePackageRoot_, "source-manifest.json"),
    "k6 source manifest",
  );
  assertDeepExact(
    sourceManifest,
    readJson(
      committedSourceManifestPath(normalizedRoot),
      "committed source manifest",
    ),
    "k6 source manifest and committed source-manifest.json",
  );
  const archivePath = path.join(
    sourcePackageRoot_,
    K6_BUILD_CONTRACT.sourceArchive,
  );
  const archive = await inspectK6SourceArchive(archivePath);
  assertSourceManifest({
    archive,
    manifest: sourceManifest,
    sourcePackage,
    sourcePackageRoot: sourcePackageRoot_,
  });
  verifyK6SourcePackageNotice(sourcePackageRoot_, sourceManifest);

  const requestedTargets = options.targets ?? K6_PLATFORM_TARGETS;
  const platformMaterials = [];
  for (const target_ of requestedTargets) {
    platformMaterials.push(
      await verifyPlatformMaterial({
        repoRoot: normalizedRoot,
        sourceManifest,
        sourcePackage,
        sourcePackageRoot: sourcePackageRoot_,
        target: target_,
      }),
    );
  }
  const canonicalModulePlatform = platformMaterials.find(
    (material) => material.target.suffix === "linux-x64",
  );
  if (canonicalModulePlatform !== undefined) {
    assertDeepExact(
      sourceManifest.modules,
      canonicalModulePlatform.provenance.modules,
      "source manifest canonical linked module graph",
    );
  }
  return Object.freeze({
    platforms: Object.freeze(platformMaterials),
    sourceManifest,
    sourcePackage,
  });
}

export function parseGoVersionMetadata(output) {
  if (typeof output !== "string" || output.trim() === "") {
    throw new Error("go version metadata must be non-empty text");
  }
  const lines = output.split(/\r?\n/u);
  const header = lines.shift()?.trim() ?? "";
  const headerMatch = /:\s+(go\d+\.\d+\.\d+)$/u.exec(header);
  if (!headerMatch) {
    throw new Error(`go version metadata has an invalid header: ${header}`);
  }
  const modules = [];
  const settings: any = {};
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const fields = line.split("\t");
    if (fields[0] === "dep") {
      if (
        !new Set([3, 4]).has(fields.length) ||
        (fields[3] !== undefined && !fields[3].startsWith("h1:"))
      ) {
        throw new Error(`go version dependency metadata is invalid: ${line}`);
      }
      modules.push(
        Object.freeze({
          module: fields[1],
          sum: fields[3] ?? null,
          version: fields[2],
        }),
      );
      continue;
    }
    if (fields[0] === "build" && fields.length === 2) {
      const separator = fields[1].indexOf("=");
      const key = separator === -1 ? fields[1] : fields[1].slice(0, separator);
      const value = separator === -1 ? true : fields[1].slice(separator + 1);
      settings[key] = value;
    }
  }
  return Object.freeze({
    goVersion: headerMatch[1],
    modules: Object.freeze(modules.sort(compareModules)),
    settings: Object.freeze(settings),
  });
}

export async function inspectEmbeddedGoMetadata(
  executablePath,
  { cwd, env, label, runCommand = runManagedCommand },
) {
  const result = await runCommand("go", ["version", "-m", executablePath], {
    cwd,
    env,
    label,
    timeoutMs: K6_EMBEDDED_GO_METADATA_TIMEOUT_MS,
  });
  return parseGoVersionMetadata(result.stdout);
}

export function sha256File(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

export function createK6PlatformSourceNotice(sourceManifest, target_) {
  return `# Source and license materials

This ${target_.platform}/${target_.architecture} custom k6 executable was built
from the archive exported by
\`${K6_BUILD_CONTRACT.sourcePackage}@${sourceManifest.package.version}\` at
\`${K6_BUILD_CONTRACT.sourceArchive}\`.

Archive SHA-256: \`${sourceManifest.sourceArchive.sha256}\`

The source package contains the buildable vendored source tree, exact module
graph and checksums, pinned builder inputs, and upstream license texts. This
platform package repeats those license texts and adds target-specific SPDX and
provenance records under \`metadata/\`.

These materials are intended to make the technical distribution auditable.
They do not constitute legal advice or replace legal review before publishing.
`;
}

export function createK6SourcePackageNotice(sourceManifest) {
  const packageName = sourceManifest.package?.name;
  const packageVersion = sourceManifest.package?.version;
  const archivePath = sourceManifest.sourceArchive?.path;
  const archiveSha256 = sourceManifest.sourceArchive?.sha256;
  const archiveSize = sourceManifest.sourceArchive?.size;
  assertEqual(
    packageName,
    K6_BUILD_CONTRACT.sourcePackage,
    "k6 source notice package name",
  );
  for (const [label, value] of [
    ["package version", packageVersion],
    ["archive path", archivePath],
    ["archive SHA-256", archiveSha256],
  ]) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`k6 source notice ${label} must be non-empty text`);
    }
  }
  if (!Number.isSafeInteger(archiveSize) || archiveSize <= 0) {
    throw new Error("k6 source notice archive size must be a positive integer");
  }
  const components = [
    K6_BUILD_CONTRACT.k6,
    K6_BUILD_CONTRACT.xk6,
    ...K6_BUILD_CONTRACT.extensions,
  ]
    .map((component) => `- \`${component.module}@${component.version}\``)
    .join("\n");

  return `# Testkit k6 build-source materials

\`${packageName}@${packageVersion}\` accompanies the custom k6 executable
distributed by the five
\`@gfdelarue/testkit-engine-k6-<platform>-<architecture>\` packages. It contains a
buildable, vendored source archive, its exact module inventory, and the upstream
license texts collected by the pinned build pipeline.

The archive is generated from these pinned components:

${components}

Source archive: \`${archivePath}\`

Archive SHA-256: \`${archiveSha256}\`

Archive size: \`${archiveSize.toString()}\` bytes

\`source-manifest.json\` records the exact Go toolchain, source-generator inputs,
module graph, checksums, licenses, and archive identity. Each platform package
contains a target-specific SBOM and provenance record whose subject digest must
match its executable.

These files make the technical release inputs inspectable and rebuildable. They
are not a legal opinion or a claim that every distribution obligation has been
satisfied. The release owner must obtain legal review before publishing the
binary packages.
`;
}

export function writeK6SourcePackageNotice(sourcePackageRoot_, sourceManifest) {
  const noticePath = path.join(sourcePackageRoot_, "SOURCE.md");
  fs.rmSync(noticePath, { force: true, recursive: true });
  fs.writeFileSync(noticePath, createK6SourcePackageNotice(sourceManifest), {
    encoding: "utf8",
    mode: 0o644,
  });
  fs.chmodSync(noticePath, 0o644);
  return noticePath;
}

export function verifyK6SourcePackageNotice(
  sourcePackageRoot_,
  sourceManifest,
) {
  const noticePath = path.join(sourcePackageRoot_, "SOURCE.md");
  let stats;
  try {
    stats = fs.lstatSync(noticePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`k6 source package notice is missing: ${noticePath}`, {
        cause: error,
      });
    }
    throw new Error(
      `k6 source package notice cannot be inspected: ${noticePath}`,
      { cause: error },
    );
  }
  if (!stats.isFile()) {
    throw new Error(
      `k6 source package notice must be a regular file: ${noticePath}`,
    );
  }
  let actual;
  try {
    actual = fs.readFileSync(noticePath, "utf8");
  } catch (error) {
    throw new Error(`k6 source package notice cannot be read: ${noticePath}`, {
      cause: error,
    });
  }
  assertEqual(
    actual,
    createK6SourcePackageNotice(sourceManifest),
    "k6 source package notice",
  );
}

export function stableJson(value) {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

export function createK6SourceGenerationArguments(outputPath) {
  if (typeof outputPath !== "string" || outputPath.length === 0) {
    throw new TypeError("k6 source generation output path must be non-empty");
  }
  return Object.freeze([
    "run",
    `${K6_BUILD_CONTRACT.xk6.module}@${K6_BUILD_CONTRACT.xk6.version}`,
    "--verbose",
    "build",
    K6_BUILD_CONTRACT.k6.version,
    "--os",
    K6_BUILD_CONTRACT.sourceGenerationTarget.goos,
    "--arch",
    K6_BUILD_CONTRACT.sourceGenerationTarget.goarch,
    "--output",
    outputPath,
    "--cgo=0",
    "--build-flags=-trimpath",
    "--build-flags=-buildvcs=false",
    "--build-flags=-ldflags=-s -w",
    "--skip-cleanup",
    ...K6_BUILD_CONTRACT.extensions.flatMap((extension) => [
      "--with",
      `${extension.module}@${extension.version}`,
    ]),
  ]);
}

export function createK6SourceManifest({ archive, licenses, modules }) {
  return {
    components: {
      extensions: K6_BUILD_CONTRACT.extensions,
      k6: {
        ...K6_BUILD_CONTRACT.k6,
        license: "AGPL-3.0-only",
        licenseFile: "licenses/k6-AGPL-3.0.txt",
      },
      sourceGenerator: K6_BUILD_CONTRACT.xk6,
    },
    generatedAt: K6_BUILD_CONTRACT.generatedAt,
    generation: {
      command: sourceGenerationCommand(),
      environment: {
        CGO_ENABLED: "0",
        GOTOOLCHAIN: K6_BUILD_CONTRACT.goToolchain,
      },
      transportPolicy: PINNED_GO_MODULE_ACQUISITION_TRANSPORT_POLICY,
    },
    legalReviewRequired: true,
    licenses,
    moduleChecksums: archive.moduleChecksums,
    modules,
    package: {
      name: K6_BUILD_CONTRACT.sourcePackage,
      version: K6_RELEASE.packageVersion,
    },
    schemaVersion: 1,
    sourceArchive: {
      entries: archive.entries,
      path: K6_BUILD_CONTRACT.sourceArchive,
      root: K6_BUILD_CONTRACT.sourceRoot,
      sha256: archive.sha256,
      size: archive.size,
    },
    toolchain: {
      go: K6_BUILD_CONTRACT.goToolchain,
      xk6: K6_BUILD_CONTRACT.xk6.version,
      xk6Commit: K6_BUILD_CONTRACT.xk6.commit,
      xk6GoModSum: K6_BUILD_CONTRACT.xk6Checksums.goModSum,
      xk6ModuleSum: K6_BUILD_CONTRACT.xk6Checksums.moduleSum,
    },
  };
}

export async function inspectK6SourceArchive(archivePath) {
  return inspectSourceArchive(archivePath, {
    requiredEntries: REQUIRED_SOURCE_ENTRIES,
    sourceRoot: K6_BUILD_CONTRACT.sourceRoot,
  });
}

function assertSourceManifest({
  archive,
  manifest,
  sourcePackage,
  sourcePackageRoot: sourcePackageRoot_,
}) {
  assertExactModules(manifest.modules, "source manifest modules");
  assertChecksumCatalog(
    manifest.moduleChecksums,
    "source manifest module checksum catalog",
  );
  assertDeepExact(
    manifest.moduleChecksums,
    archive.moduleChecksums,
    "source manifest checksum catalog and archived go.sum",
  );
  assertEqual(
    manifest.package?.version,
    sourcePackage.version,
    "source manifest package version",
  );
  const licenses = expectedLicenseInventory(sourcePackageRoot_);
  const expected = createK6SourceManifest({
    archive,
    licenses,
    modules: manifest.modules,
  });
  assertDeepExact(manifest, expected, "source manifest");
}

export function createK6PlatformProvenance({
  modules,
  packageManifest,
  sourceManifest,
  subject,
  target: target_,
}) {
  return {
    builder: {
      command: ["go", ...K6_GO_BUILD_ARGUMENTS, "-o", subject.name, "."],
      environment: {
        CGO_ENABLED: "0",
        GOARCH: target_.goarch,
        GOOS: target_.goos,
        GOPROXY: "off",
        GOTOOLCHAIN: K6_BUILD_CONTRACT.goToolchain,
      },
      go: K6_BUILD_CONTRACT.goToolchain,
    },
    generatedAt: K6_BUILD_CONTRACT.generatedAt,
    legalReviewRequired: true,
    materials: {
      extensions: K6_BUILD_CONTRACT.extensions,
      k6: K6_BUILD_CONTRACT.k6,
      sourceArchive: {
        package: `${K6_BUILD_CONTRACT.sourcePackage}@${sourceManifest.package.version}`,
        path: K6_BUILD_CONTRACT.sourceArchive,
        sha256: sourceManifest.sourceArchive.sha256,
        size: sourceManifest.sourceArchive.size,
      },
    },
    modules,
    package: {
      name: packageManifest.name,
      version: packageManifest.version,
    },
    schemaVersion: 1,
    sourceGenerator: {
      command: [
        "go",
        "run",
        `${K6_BUILD_CONTRACT.xk6.module}@${K6_BUILD_CONTRACT.xk6.version}`,
      ],
      commit: K6_BUILD_CONTRACT.xk6.commit,
      xk6: K6_BUILD_CONTRACT.xk6.version,
    },
    subject,
    target: {
      architecture: target_.architecture,
      goarch: target_.goarch,
      goos: target_.goos,
      platform: target_.platform,
    },
  };
}

export function createK6SpdxDocument({ provenance, target: target_ }) {
  const binaryId = "SPDXRef-Package-Testkit-k6";
  const modulePackages = provenance.modules.map((module) => ({
    SPDXID: moduleSpdxId(module.module),
    copyrightText: "NOASSERTION",
    downloadLocation: "NOASSERTION",
    externalRefs: [
      {
        referenceCategory: "PACKAGE-MANAGER",
        referenceLocator: `pkg:golang/${encodeURIComponent(module.module)}@${encodeURIComponent(module.version)}`,
        referenceType: "purl",
      },
    ],
    filesAnalyzed: false,
    licenseConcluded: "NOASSERTION",
    licenseDeclared: declaredLicense(module.module),
    name: module.module,
    packageComment: `Go module sum: ${module.sum}`,
    versionInfo: module.version,
  }));
  return {
    SPDXID: "SPDXRef-DOCUMENT",
    creationInfo: {
      comment:
        "This SBOM inventories the linked Go modules; it is technical evidence and does not replace legal review.",
      created: K6_BUILD_CONTRACT.generatedAt,
      creators: ["Tool: Testkit pinned k6 release builder"],
    },
    dataLicense: "CC0-1.0",
    documentNamespace: `https://elench.dev/spdx/testkit-k6/${provenance.package.version}/${target_.suffix}/${provenance.subject.sha256}`,
    name: `${provenance.package.name}-${provenance.package.version}`,
    packages: [
      {
        SPDXID: binaryId,
        checksums: [
          {
            algorithm: "SHA256",
            checksumValue: provenance.subject.sha256,
          },
        ],
        copyrightText: "NOASSERTION",
        downloadLocation: "NOASSERTION",
        filesAnalyzed: false,
        licenseConcluded: "NOASSERTION",
        licenseDeclared: "NOASSERTION",
        name: provenance.package.name,
        packageComment: `Custom k6 executable for ${target_.platform}/${target_.architecture}`,
        versionInfo: K6_BUILD_CONTRACT.k6.version,
      },
      ...modulePackages,
    ],
    relationships: modulePackages.map((module) => ({
      relatedSpdxElement: module.SPDXID,
      relationshipType: "DEPENDS_ON",
      spdxElementId: binaryId,
    })),
    spdxVersion: "SPDX-2.3",
  };
}

async function verifyPlatformMaterial({
  repoRoot,
  sourceManifest,
  sourcePackage,
  sourcePackageRoot: sourcePackageRoot_,
  target: target_,
}) {
  const packageRoot = targetPackageRoot(repoRoot, target_);
  const manifest = readJson(
    path.join(packageRoot, "package.json"),
    `${target_.suffix} package`,
  );
  assertDeepExact(
    manifest,
    createPlatformPackageManifest(target_),
    `${target_.suffix} package manifest`,
  );
  assertEqual(
    manifest.dependencies?.[K6_BUILD_CONTRACT.sourcePackage],
    sourcePackage.version,
    `${target_.suffix} source dependency`,
  );
  const { executablePath, provenance, sbom } = await readK6PlatformMaterial(
    packageRoot,
    target_,
  );
  const subject = {
    mode: target_.platform === "win32" ? "0644" : "0755",
    name: `bin/${target_.executable}`,
    sha256: sha256File(executablePath),
    size: fs.statSync(executablePath).size,
  };
  assertEqual(
    subject.sha256,
    K6_RELEASE.expectedExecutables[target_.suffix],
    `${target_.suffix} executable SHA-256`,
  );
  assertModulesFromCatalog(
    provenance.modules,
    sourceManifest.moduleChecksums,
    `${target_.suffix} provenance modules`,
  );
  const expectedProvenance = createK6PlatformProvenance({
    modules: provenance.modules,
    packageManifest: manifest,
    sourceManifest,
    subject,
    target: target_,
  });
  assertDeepExact(
    provenance,
    expectedProvenance,
    `${target_.suffix} provenance`,
  );
  const metadata = await inspectEmbeddedGoMetadata(executablePath, {
    cwd: repoRoot,
    env: goInspectionEnvironment(),
    label: `${target_.suffix} embedded Go metadata inspection`,
  });
  assertEqual(
    metadata.goVersion,
    K6_BUILD_CONTRACT.goToolchain,
    `${target_.suffix} embedded Go version`,
  );
  assertEqual(
    metadata.settings.GOOS,
    target_.goos,
    `${target_.suffix} embedded GOOS`,
  );
  assertEqual(
    metadata.settings.GOARCH,
    target_.goarch,
    `${target_.suffix} embedded GOARCH`,
  );
  assertEqual(
    metadata.settings.CGO_ENABLED,
    "0",
    `${target_.suffix} embedded CGO setting`,
  );
  assertModuleIdentitiesEqual(
    metadata.modules,
    provenance.modules,
    `${target_.suffix} embedded modules`,
  );
  assertDeepExact(
    sbom,
    createK6SpdxDocument({ provenance, target: target_ }),
    `${target_.suffix} SBOM`,
  );
  for (const license of sourceManifest.licenses) {
    const sourceLicense = path.join(sourcePackageRoot_, license.path);
    const platformLicense = path.join(packageRoot, license.path);
    const sourceBytes = fs.readFileSync(sourceLicense);
    if (!sourceBytes.equals(fs.readFileSync(platformLicense))) {
      throw new Error(`${target_.suffix} license differs from ${license.path}`);
    }
  }
  const sourceReference = fs.readFileSync(
    path.join(packageRoot, "SOURCE.md"),
    "utf8",
  );
  assertEqual(
    sourceReference,
    createK6PlatformSourceNotice(sourceManifest, target_),
    `${target_.suffix} source reference`,
  );
  return Object.freeze({
    manifest,
    metadata,
    provenance,
    sbom,
    target: target_,
  });
}

export async function readK6PlatformMaterial(packageRoot, target_) {
  const executablePath = path.join(packageRoot, "bin", target_.executable);
  const provenancePath = path.join(packageRoot, "metadata", "provenance.json");
  const sbomPath = path.join(packageRoot, "metadata", "sbom.spdx.json");
  assertRegularK6Material(
    executablePath,
    `${target_.suffix} binary`,
    target_.platform === "win32" ? undefined : 0o755,
  );
  assertRegularK6Material(provenancePath, `${target_.suffix} provenance`);
  assertRegularK6Material(sbomPath, `${target_.suffix} SBOM`);
  return Object.freeze({
    executablePath,
    provenance: readJson(provenancePath, `${target_.suffix} provenance`),
    sbom: readJson(sbomPath, `${target_.suffix} SBOM`),
  });
}

function goInspectionEnvironment() {
  return { ...process.env, GOTOOLCHAIN: K6_BUILD_CONTRACT.goToolchain };
}

function assertRegularK6Material(filePath, label, expectedMode = undefined) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    throw new Error(`${label} is missing: ${filePath}`, { cause: error });
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file: ${filePath}`);
  }
  if (expectedMode !== undefined && (stat.mode & 0o777) !== expectedMode) {
    throw new Error(
      `${label} mode is ${(stat.mode & 0o777).toString(8)}, expected ${expectedMode.toString(8)}: ${filePath}`,
    );
  }
}

function assertExactModules(modules, label) {
  if (!Array.isArray(modules) || modules.length === 0) {
    throw new Error(`${label} must be a non-empty module graph`);
  }
  const normalized = modules.map((module) => ({
    module: module.module,
    sum: module.sum,
    version: module.version,
  }));
  const sorted = [...normalized].sort(compareModules);
  if (JSON.stringify(normalized) !== JSON.stringify(sorted)) {
    throw new Error(`${label} must use deterministic module ordering`);
  }
  const unique = new Set(normalized.map((module) => module.module));
  if (unique.size !== normalized.length) {
    throw new Error(`${label} contains duplicate modules`);
  }
  for (const module of normalized) {
    if (!/^h1:[A-Za-z0-9+/=]+$/u.test(module.sum)) {
      throw new Error(`${label} ${module.module} omits its exact Go checksum`);
    }
  }
  for (const expected of [
    K6_BUILD_CONTRACT.k6,
    ...K6_BUILD_CONTRACT.extensions,
  ]) {
    const actual = normalized.find(
      (module) => module.module === expected.module,
    );
    assertEqual(
      actual?.version,
      expected.version,
      `${label} ${expected.module}`,
    );
  }
  const grpc = normalized.find(
    (module) => module.module === "google.golang.org/grpc",
  );
  assertEqual(grpc?.version, "v1.79.3", `${label} patched gRPC dependency`);
}

function assertChecksumCatalog(modules, label) {
  if (!Array.isArray(modules) || modules.length === 0) {
    throw new Error(`${label} must be non-empty`);
  }
  const keys = modules.map((module) => `${module.module}@${module.version}`);
  if (new Set(keys).size !== keys.length) {
    throw new Error(`${label} contains duplicate module versions`);
  }
  for (const module of modules) {
    if (!/^h1:[A-Za-z0-9+/=]+$/u.test(module.sum)) {
      throw new Error(`${label} ${module.module} omits its exact Go checksum`);
    }
  }
  const sorted = [...modules].sort((left, right) =>
    left.module === right.module
      ? compareText(left.version, right.version)
      : compareText(left.module, right.module),
  );
  if (JSON.stringify(modules) !== JSON.stringify(sorted)) {
    throw new Error(`${label} must use deterministic module ordering`);
  }
}

function assertModuleIdentitiesEqual(actual, expected, label) {
  const identities = (modules) =>
    modules.map(({ module, version }) => ({ module, version }));
  if (
    JSON.stringify(identities(actual)) !== JSON.stringify(identities(expected))
  ) {
    throw new Error(`${label} differs from the canonical source module graph`);
  }
}

function assertModulesFromCatalog(actual, catalog, label) {
  assertExactModules(actual, label);
  const expected = new Map(
    catalog.map((module) => [`${module.module}@${module.version}`, module.sum]),
  );
  for (const module of actual) {
    if (expected.get(`${module.module}@${module.version}`) !== module.sum) {
      throw new Error(
        `${label} contains a checksum outside the source catalog`,
      );
    }
  }
}

export function readJson(filePath, label = filePath) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${filePath}`, {
      cause: error,
    });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must contain an object`);
  }
  return value;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label} must be ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function compareModules(left, right) {
  return compareText(left.module, right.module);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function assertDeepExact(actual, expected, label) {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(`${label} differs from its exact canonical contract`);
  }
}

function sourceGenerationCommand() {
  return [
    "go",
    ...createK6SourceGenerationArguments("<temporary-output>/generator-k6"),
  ];
}

function expectedLicenseInventory(sourcePackageRoot_) {
  const definitions = [
    {
      component: K6_BUILD_CONTRACT.k6.module,
      path: "licenses/k6-AGPL-3.0.txt",
    },
    {
      component: K6_BUILD_CONTRACT.xk6.module,
      path: "licenses/xk6-Apache-2.0.txt",
      version: K6_BUILD_CONTRACT.xk6.version,
    },
    ...K6_BUILD_CONTRACT.extensions.map((extension) => ({
      component: extension.module,
      path: extension.licenseFile,
    })),
  ].sort((left, right) => compareText(left.path, right.path));
  return definitions.map((definition) => {
    const filePath = path.join(sourcePackageRoot_, definition.path);
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      throw new Error(`license ${definition.path} is not a regular file`);
    }
    const version = (definition as { version?: string }).version;
    return {
      component: definition.component,
      path: definition.path,
      sha256: sha256File(filePath),
      size: stats.size,
      ...(version ? { version } : {}),
    };
  });
}

export function parseGoSumText(source) {
  return parseGoSumCatalog(source);
}

function declaredLicense(module) {
  if (module === K6_BUILD_CONTRACT.k6.module) return "AGPL-3.0-only";
  const extension = K6_BUILD_CONTRACT.extensions.find(
    (candidate) => candidate.module === module,
  );
  return extension?.license ?? "NOASSERTION";
}

function moduleSpdxId(module) {
  const digest = crypto
    .createHash("sha256")
    .update(module)
    .digest("hex")
    .slice(0, 32);
  return `SPDXRef-GoModule-${digest}`;
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key])]),
  );
}

function target(
  platform,
  architecture,
  goarch,
  executable,
  label,
  goos = platform,
) {
  const suffix = `${platform}-${architecture}`;
  return Object.freeze({
    architecture,
    executable,
    goarch,
    goos,
    label,
    packageDirectory: `testkit-engine-k6-${suffix}`,
    packageName: `@gfdelarue/testkit-engine-k6-${suffix}`,
    platform,
    suffix,
  });
}
