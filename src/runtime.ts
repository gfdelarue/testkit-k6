import fs from "node:fs";
import path from "node:path";
import { format as formatWithPrettier } from "prettier";
import { create as createTar, extract as extractTar } from "tar";
import {
  K6_BUILD_CONTRACT,
  K6_GO_BUILD_ARGUMENTS,
  K6_PLATFORM_TARGETS,
  K6_RELEASE,
  REPOSITORY_ROOT,
  committedSourceManifestPath,
  createK6SourceGenerationArguments,
  createK6PlatformProvenance,
  createK6PlatformSourceNotice,
  createK6SourceManifest,
  createK6SpdxDocument,
  inspectK6SourceArchive,
  parseGoVersionMetadata,
  readJson,
  sha256File,
  sourcePackageRoot,
  stableJson,
  targetPackageRoot,
  verifyK6ReleaseMaterials,
  writeK6SourcePackageNotice,
  writePackageManifests,
} from "./contract.ts";
import { pinnedGoBuildEnvironment } from "./environment.ts";
import {
  PINNED_GO_MODULE_ACQUISITION_ATTEMPTS,
  runPinnedGoModuleAcquisition,
  runPinnedK6SourceGeneration,
} from "./materials.ts";
import { runManagedCommand, runManagedStreamingCommand } from "./command.ts";

const SOURCE_DATE = new Date(K6_BUILD_CONTRACT.generatedAt);
const LICENSE_INPUTS = Object.freeze([
  Object.freeze({
    destination: "licenses/k6-AGPL-3.0.txt",
    source: "vendor/go.k6.io/k6/LICENSE.md",
  }),
  Object.freeze({
    destination: "licenses/xk6-sql-Apache-2.0.txt",
    source: "vendor/github.com/grafana/xk6-sql/LICENSE",
  }),
  Object.freeze({
    destination: "licenses/xk6-sql-driver-postgres-AGPL-3.0.txt",
    source: "vendor/github.com/grafana/xk6-sql-driver-postgres/LICENSE",
  }),
]);

const options = parseArguments(process.argv.slice(2));
writePackageManifests(REPOSITORY_ROOT);
if (options.refreshSource) {
  await refreshSourceMaterials();
}

const requestedTargets = options.all
  ? K6_PLATFORM_TARGETS
  : options.refreshSource
    ? []
    : K6_PLATFORM_TARGETS.filter(
        (target) =>
          target.platform === process.platform &&
          target.architecture === process.arch,
      );
if (!options.refreshSource && requestedTargets.length === 0) {
  throw new Error(`No k6 build target for ${process.platform}/${process.arch}`);
}
if (requestedTargets.length > 0) {
  await assertPinnedGoToolchain();
  for (const target of requestedTargets) await buildTarget(target);
  await verifyK6ReleaseMaterials(REPOSITORY_ROOT, {
    targets: requestedTargets,
  });
  for (const target of requestedTargets) {
    const output = path.join(
      targetPackageRoot(REPOSITORY_ROOT, target),
      "bin",
      target.executable,
    );
    console.log(
      `${target.suffix} ${sha256File(output)} ${fs.statSync(output).size.toString()} bytes`,
    );
  }
  console.log(
    `Built ${requestedTargets.length.toString()} k6 ${K6_RELEASE.k6Version} target(s) for package version ${K6_RELEASE.packageVersion}`,
  );
}

async function refreshSourceMaterials() {
  await assertPinnedGoToolchain();
  await inspectPinnedXk6();
  const temporaryRoot = makeBuildTempRoot("source-");
  try {
    const generation = await runPinnedK6SourceGeneration({
      createArguments: createK6SourceGenerationArguments,
      createEnvironment: pinnedGoEnvironment,
      runAttempt: ({
        arguments: arguments_,
        attempt,
        environment,
        timeoutMs,
      }) =>
        runGo(arguments_, {
          cwd: REPOSITORY_ROOT,
          env: environment,
          label: `pinned xk6 source generation attempt ${attempt.toString()}/${PINNED_GO_MODULE_ACQUISITION_ATTEMPTS.toString()}`,
          stream: true,
          timeoutMs,
        }),
      temporaryRoot,
    });
    const sourceTree = generation.sourceTree;
    const generatedMetadata = await inspectBinary(generation.generatorOutput);
    assertGeneratedModuleGraph(generatedMetadata.modules);
    for (const executable of ["k6", "k6.exe"]) {
      fs.rmSync(path.join(sourceTree, executable), { force: true });
    }
    await runGoModuleAcquisition(["mod", "vendor"], {
      cwd: sourceTree,
      label: "pinned k6 source vendoring",
      stream: true,
      timeoutMs: 10 * 60 * 1_000,
    });
    fs.writeFileSync(
      path.join(sourceTree, "BUILD.md"),
      sourceBuildInstructions(),
    );
    normalizeSourceTree(sourceTree);

    const destinationRoot = sourcePackageRoot(REPOSITORY_ROOT);
    const archivePath = path.join(
      destinationRoot,
      K6_BUILD_CONTRACT.sourceArchive,
    );
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    const temporaryArchive = `${archivePath}.tmp-${process.pid.toString()}`;
    fs.rmSync(temporaryArchive, { force: true });
    await createTar(
      {
        cwd: sourceTree,
        file: temporaryArchive,
        gzip: true,
        mtime: SOURCE_DATE,
        portable: true,
        prefix: K6_BUILD_CONTRACT.sourceRoot,
        strict: true,
      },
      fs.readdirSync(sourceTree).sort(),
    );
    fs.renameSync(temporaryArchive, archivePath);

    const licenses = await installLicenseMaterials({
      destinationRoot,
      sourceTree,
    });
    const archive = await inspectK6SourceArchive(archivePath);
    const sourceManifest = createK6SourceManifest({
      archive,
      licenses,
      modules: generatedMetadata.modules,
    });
    const manifestText = await formatJson(sourceManifest);
    const committedPath = committedSourceManifestPath(REPOSITORY_ROOT);
    const committedText = fs.existsSync(committedPath)
      ? fs.readFileSync(committedPath, "utf8")
      : undefined;
    if (committedText !== manifestText) {
      if (!options.acceptSource) {
        throw new Error(
          `The regenerated source manifest differs from ${committedPath}; rerun with --accept-source to record the new source identity`,
        );
      }
      fs.writeFileSync(committedPath, manifestText);
      console.log(`Updated ${committedPath}`);
    }
    fs.writeFileSync(
      path.join(destinationRoot, "source-manifest.json"),
      manifestText,
    );
    writeK6SourcePackageNotice(destinationRoot, sourceManifest);
    console.log(
      `Generated ${K6_BUILD_CONTRACT.sourcePackage} from pinned xk6 ${K6_BUILD_CONTRACT.xk6.version} with ${generatedMetadata.modules.length.toString()} linked modules; archive ${archive.sha256}`,
    );
  } finally {
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

async function buildTarget(target) {
  const sourceRoot = sourcePackageRoot(REPOSITORY_ROOT);
  const sourceManifest = readJson(committedSourceManifestPath(REPOSITORY_ROOT));
  const archivePath = path.join(sourceRoot, K6_BUILD_CONTRACT.sourceArchive);
  if (!fs.existsSync(archivePath)) {
    throw new Error(
      `The k6 source archive is not generated at ${archivePath}; run npm run build -- --refresh-source first`,
    );
  }
  if (sourceManifest.sourceArchive?.sha256 !== sha256File(archivePath)) {
    throw new Error(
      "The generated k6 source archive does not match source-manifest.json; rerun npm run build -- --refresh-source",
    );
  }
  const temporaryRoot = makeBuildTempRoot(`${target.suffix}-`);
  try {
    await extractTar({
      cwd: temporaryRoot,
      file: archivePath,
      preservePaths: false,
      strict: true,
    });
    const sourceTree = path.join(temporaryRoot, K6_BUILD_CONTRACT.sourceRoot);
    const packageRoot = targetPackageRoot(REPOSITORY_ROOT, target);
    const output = path.join(packageRoot, "bin", target.executable);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const buildArguments = [...K6_GO_BUILD_ARGUMENTS, "-o", output, "."];
    console.log(`Building ${target.packageDirectory}/bin/${target.executable}`);
    await runGo(buildArguments, {
      cwd: sourceTree,
      env: pinnedGoEnvironment({
        CGO_ENABLED: "0",
        GOARCH: target.goarch,
        GOOS: target.goos,
        GOPROXY: "off",
      }),
      label: `${target.suffix} pinned k6 build`,
      stream: true,
      timeoutMs: 20 * 60 * 1_000,
    });
    fs.chmodSync(output, target.platform === "win32" ? 0o644 : 0o755);
    const metadata = await inspectBinary(output);
    assertTargetMetadata(metadata, target);
    const modules = resolveTargetModules(
      metadata.modules,
      sourceManifest.moduleChecksums,
    );
    await writePlatformMaterials({
      modules,
      output,
      packageRoot,
      sourceManifest,
      sourceRoot,
      target,
    });
  } finally {
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

async function writePlatformMaterials({
  modules,
  output,
  packageRoot,
  sourceManifest,
  sourceRoot,
  target,
}) {
  const packageManifest = readJson(path.join(packageRoot, "package.json"));
  const subject = {
    mode: target.platform === "win32" ? "0644" : "0755",
    name: `bin/${target.executable}`,
    sha256: sha256File(output),
    size: fs.statSync(output).size,
  };
  const provenance = createK6PlatformProvenance({
    modules,
    packageManifest,
    sourceManifest,
    subject,
    target,
  });
  const metadataRoot = path.join(packageRoot, "metadata");
  fs.mkdirSync(metadataRoot, { recursive: true });
  await writeJson(path.join(metadataRoot, "provenance.json"), provenance);
  await writeJson(
    path.join(metadataRoot, "sbom.spdx.json"),
    createK6SpdxDocument({ provenance, target }),
  );
  copyLicenseDirectory(sourceRoot, packageRoot, sourceManifest.licenses);
  fs.writeFileSync(
    path.join(packageRoot, "SOURCE.md"),
    createK6PlatformSourceNotice(sourceManifest, target),
  );
}

async function installLicenseMaterials({ destinationRoot, sourceTree }) {
  const records = [];
  for (const license of LICENSE_INPUTS) {
    records.push(copyLicense(sourceTree, destinationRoot, license));
  }
  const moduleDownload = await inspectPinnedXk6();
  const moduleCache = (
    await runGo(["env", "GOMODCACHE"], {
      cwd: REPOSITORY_ROOT,
      env: pinnedGoEnvironment(),
      label: "pinned Go module cache lookup",
      timeoutMs: 30_000,
    })
  ).stdout.trim();
  const xk6LicenseSource = path.join(
    moduleCache,
    `go.k6.io/xk6@${K6_BUILD_CONTRACT.xk6.version}`,
    "LICENSE",
  );
  const xk6LicenseDestination = path.join(
    destinationRoot,
    "licenses",
    "xk6-Apache-2.0.txt",
  );
  fs.mkdirSync(path.dirname(xk6LicenseDestination), { recursive: true });
  copyGeneratedFile(xk6LicenseSource, xk6LicenseDestination);
  records.push({
    component: K6_BUILD_CONTRACT.xk6.module,
    path: "licenses/xk6-Apache-2.0.txt",
    sha256: sha256File(xk6LicenseDestination),
    size: fs.statSync(xk6LicenseDestination).size,
    version: K6_BUILD_CONTRACT.xk6.version,
  });
  if (moduleDownload.sum === "" || moduleDownload.goModSum === "") {
    throw new Error("Pinned xk6 download metadata omits module checksums");
  }
  return records.sort((left, right) => left.path.localeCompare(right.path));
}

function copyLicense(sourceTree, destinationRoot, license) {
  const source = path.join(sourceTree, license.source);
  const destination = path.join(destinationRoot, license.destination);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  copyGeneratedFile(source, destination);
  return {
    component: license.source.includes("driver-postgres")
      ? "github.com/grafana/xk6-sql-driver-postgres"
      : license.source.includes("xk6-sql")
        ? "github.com/grafana/xk6-sql"
        : "go.k6.io/k6",
    path: license.destination,
    sha256: sha256File(destination),
    size: fs.statSync(destination).size,
  };
}

function copyLicenseDirectory(sourceRoot, packageRoot, licenses) {
  for (const license of licenses) {
    const source = path.join(sourceRoot, license.path);
    const destination = path.join(packageRoot, license.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    copyGeneratedFile(source, destination);
  }
}

function copyGeneratedFile(source, destination) {
  fs.rmSync(destination, { force: true });
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, 0o644);
}

async function inspectPinnedXk6() {
  const specifier = `go.k6.io/xk6@${K6_BUILD_CONTRACT.xk6.version}`;
  const download = JSON.parse(
    (
      await runGoModuleAcquisition(["mod", "download", "-json", specifier], {
        cwd: REPOSITORY_ROOT,
        label: `pinned xk6 module download ${specifier}`,
        timeoutMs: 5 * 60 * 1_000,
      })
    ).stdout,
  );
  if (
    download.Version !== K6_BUILD_CONTRACT.xk6.version ||
    download.Sum !== K6_BUILD_CONTRACT.xk6Checksums.moduleSum ||
    download.GoModSum !== K6_BUILD_CONTRACT.xk6Checksums.goModSum
  ) {
    throw new Error(`Pinned xk6 download metadata is invalid for ${specifier}`);
  }
  const version = (
    await runGoModuleAcquisition(
      [
        "run",
        `${K6_BUILD_CONTRACT.xk6.module}@${K6_BUILD_CONTRACT.xk6.version}`,
        "version",
      ],
      {
        cwd: REPOSITORY_ROOT,
        label: "pinned xk6 version inspection",
        timeoutMs: 10 * 60 * 1_000,
      },
    )
  ).stdout.trim();
  if (version !== `xk6 version ${K6_BUILD_CONTRACT.xk6.version.slice(1)}`) {
    throw new Error(
      `Pinned xk6 version must be ${K6_BUILD_CONTRACT.xk6.version}, got ${version}`,
    );
  }
  return Object.freeze({ goModSum: download.GoModSum, sum: download.Sum });
}

async function assertPinnedGoToolchain() {
  const version = (
    await runGoModuleAcquisition(["version"], {
      cwd: REPOSITORY_ROOT,
      label: "pinned Go toolchain inspection",
      timeoutMs: 5 * 60 * 1_000,
    })
  ).stdout.trim();
  const expectedPrefix = `go version ${K6_BUILD_CONTRACT.goToolchain} `;
  if (!version.startsWith(expectedPrefix)) {
    throw new Error(
      `Pinned Go toolchain must report ${K6_BUILD_CONTRACT.goToolchain}, got ${version}`,
    );
  }
}

async function inspectBinary(executable) {
  return parseGoVersionMetadata(
    (
      await runGo(["version", "-m", executable], {
        cwd: REPOSITORY_ROOT,
        env: pinnedGoEnvironment(),
        label: `Go metadata inspection for ${path.basename(executable)}`,
        timeoutMs: 30_000,
      })
    ).stdout,
  );
}

function runGo(
  args,
  { cwd, env, label, stream = false, timeoutMs },
): Promise<any> {
  const runner = stream ? runManagedStreamingCommand : runManagedCommand;
  return runner("go", args, { cwd, env, label, timeoutMs });
}

function runGoModuleAcquisition(
  args,
  { cwd, label, stream = false, timeoutMs },
) {
  return runPinnedGoModuleAcquisition({
    createEnvironment: (overrides) => pinnedGoEnvironment(overrides),
    operationLabel: label,
    runAttempt: ({ attempt, environment, timeoutMs: remainingTimeoutMs }) =>
      runGo(args, {
        cwd,
        env: environment,
        label: `${label} attempt ${attempt.toString()}/${PINNED_GO_MODULE_ACQUISITION_ATTEMPTS.toString()}`,
        stream,
        timeoutMs: remainingTimeoutMs,
      }),
    timeoutMs,
  });
}

function assertGeneratedModuleGraph(modules) {
  for (const component of [
    K6_BUILD_CONTRACT.k6,
    ...K6_BUILD_CONTRACT.extensions,
  ]) {
    const module = modules.find(
      (candidate) => candidate.module === component.module,
    );
    if (
      module?.version !== component.version ||
      !module.sum.startsWith("h1:")
    ) {
      throw new Error(
        `Generated module graph must contain ${component.module}@${component.version} with a Go checksum`,
      );
    }
  }
  const grpc = modules.find(
    (module) => module.module === "google.golang.org/grpc",
  );
  if (grpc?.version !== "v1.79.3") {
    throw new Error(
      `k6 ${K6_BUILD_CONTRACT.k6.version} must resolve patched google.golang.org/grpc@v1.79.3, got ${String(grpc?.version)}`,
    );
  }
}

function assertTargetMetadata(metadata, target) {
  if (metadata.goVersion !== K6_BUILD_CONTRACT.goToolchain) {
    throw new Error(
      `${target.suffix} embedded unexpected Go ${metadata.goVersion}`,
    );
  }
  if (
    metadata.settings.GOOS !== target.goos ||
    metadata.settings.GOARCH !== target.goarch ||
    metadata.settings.CGO_ENABLED !== "0"
  ) {
    throw new Error(
      `${target.suffix} embedded build settings do not match target`,
    );
  }
}

function resolveTargetModules(modules, moduleChecksums) {
  const checksums = new Map(
    moduleChecksums.map((module) => [
      `${module.module}@${module.version}`,
      module.sum,
    ]),
  );
  return modules.map(({ module, version }) => {
    const sum = checksums.get(`${module}@${version}`);
    if (sum === undefined) {
      throw new Error(
        `The vendored source checksum catalog omits ${module}@${version}`,
      );
    }
    return { module, sum, version };
  });
}

function normalizeSourceTree(root) {
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(
          `k6 source tree contains unsupported symlink: ${entryPath}`,
        );
      }
      if (entry.isDirectory()) {
        fs.chmodSync(entryPath, 0o755);
        fs.utimesSync(entryPath, SOURCE_DATE, SOURCE_DATE);
        visit(entryPath);
      } else if (entry.isFile()) {
        fs.chmodSync(entryPath, 0o644);
        fs.utimesSync(entryPath, SOURCE_DATE, SOURCE_DATE);
      } else {
        throw new Error(
          `k6 source tree contains unsupported entry: ${entryPath}`,
        );
      }
    }
  };
  visit(root);
  fs.chmodSync(root, 0o755);
  fs.utimesSync(root, SOURCE_DATE, SOURCE_DATE);
}

function sourceBuildInstructions() {
  return `# Rebuilding the Testkit custom k6 executable

This archive is the normalized, vendored Go source tree generated by
${K6_BUILD_CONTRACT.xk6.module}@${K6_BUILD_CONTRACT.xk6.version} for
${K6_BUILD_CONTRACT.k6.module}@${K6_BUILD_CONTRACT.k6.version},
${K6_BUILD_CONTRACT.extensions.map((extension) => `${extension.module}@${extension.version}`).join(", ")}.

Use exactly Go ${K6_BUILD_CONTRACT.goToolchain}. From this directory, build a
target with:

\`\`\`sh
GOTOOLCHAIN=${K6_BUILD_CONTRACT.goToolchain} GOPROXY=off CGO_ENABLED=0 GOOS=<goos> GOARCH=<goarch> \\
  go build -mod=vendor -trimpath -buildvcs=false -ldflags='-s -w -buildid=' -o <output> .
\`\`\`

No module download is required by that command. The release-level build script
verifies the exact toolchain, module graph, target settings, and output digest.
This build documentation is technical evidence, not legal advice; publishing
the binary remains subject to legal review.
`;
}

function pinnedGoEnvironment(overrides: any = {}) {
  return pinnedGoBuildEnvironment({
    goToolchain: K6_BUILD_CONTRACT.goToolchain,
    overrides,
    packageRoot: REPOSITORY_ROOT,
  });
}

function makeBuildTempRoot(prefix) {
  const parent = path.join(REPOSITORY_ROOT, ".state", "k6-release-build");
  fs.mkdirSync(parent, { recursive: true });
  return fs.mkdtempSync(path.join(parent, prefix));
}

async function formatJson(value) {
  return formatWithPrettier(stableJson(value), { parser: "json" });
}

async function writeJson(filePath, value) {
  fs.writeFileSync(filePath, await formatJson(value));
}

function parseArguments(arguments_) {
  const supported = new Set(["--accept-source", "--all", "--refresh-source"]);
  for (const argument of arguments_) {
    if (!supported.has(argument))
      throw new Error(`Unknown argument: ${argument}`);
  }
  if (new Set(arguments_).size !== arguments_.length) {
    throw new Error("Duplicate build arguments are not allowed");
  }
  if (
    arguments_.includes("--accept-source") &&
    !arguments_.includes("--refresh-source")
  ) {
    throw new Error("--accept-source requires --refresh-source");
  }
  return Object.freeze({
    acceptSource: arguments_.includes("--accept-source"),
    all: arguments_.includes("--all"),
    refreshSource: arguments_.includes("--refresh-source"),
  });
}
