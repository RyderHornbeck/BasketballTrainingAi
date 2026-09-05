const fs = require("fs");
const path = require("path");
const {
  IOSConfig,
  withDangerousMod,
  withXcodeProject,
} = require("expo/config-plugins");

const MODEL_NAME = "BasketballYOLO26FP16.mlpackage";

function sourceModelPath(projectRoot) {
  return path.join(projectRoot, "assets", "models", MODEL_NAME);
}

module.exports = function withShotTrackerModel(config) {
  config = withDangerousMod(config, [
    "ios",
    async (nextConfig) => {
      const source = sourceModelPath(nextConfig.modRequest.projectRoot);
      if (!fs.existsSync(source)) {
        throw new Error(`Shot tracker Core ML package is missing: ${source}`);
      }
      const sourceRoot = IOSConfig.Paths.getSourceRoot(
        nextConfig.modRequest.projectRoot,
      );
      const modelsDirectory = path.join(sourceRoot, "Models");
      const destination = path.join(modelsDirectory, MODEL_NAME);
      fs.mkdirSync(modelsDirectory, { recursive: true });
      fs.rmSync(destination, { recursive: true, force: true });
      fs.cpSync(source, destination, { recursive: true });
      return nextConfig;
    },
  ]);

  return withXcodeProject(config, (nextConfig) => {
    const project = nextConfig.modResults;
    const projectName = IOSConfig.XcodeUtils.getProjectName(
      nextConfig.modRequest.projectRoot,
    );
    const relativePath = `${projectName}/Models/${MODEL_NAME}`;

    if (!project.hasFile(relativePath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath: relativePath,
        groupName: projectName,
        project,
      });
    }

    // node-xcode does not know the newer mlpackage extension. Correcting the
    // file type makes Xcode invoke coremlc in the Sources phase and place the
    // compiled BasketballYOLO26FP16.mlmodelc in the app bundle.
    const references = project.pbxFileReferenceSection();
    let modelFileReference = null;
    for (const [key, reference] of Object.entries(references)) {
      if (
        !key.endsWith("_comment") &&
        reference &&
        (reference.path === `"${relativePath}"` ||
          reference.path === relativePath ||
          reference.name === `"${MODEL_NAME}"` ||
          reference.name === MODEL_NAME)
      ) {
        reference.lastKnownFileType = "folder.mlpackage";
        delete reference.explicitFileType;
        modelFileReference = key;
      }
    }

    // Expo's generic helper initially classifies unknown `.mlpackage` files as
    // resources. Core ML packages must be in Compile Sources so Xcode runs
    // coremlc and emits the `.mlmodelc` bundle loaded by ShotTrackerEngine.
    if (modelFileReference) {
      const buildFiles = project.pbxBuildFileSection();
      let modelBuildFile = null;
      for (const [key, buildFile] of Object.entries(buildFiles)) {
        if (
          !key.endsWith("_comment") &&
          buildFile?.fileRef === modelFileReference
        ) {
          modelBuildFile = key;
          buildFiles[`${key}_comment`] = `${MODEL_NAME} in Sources`;
          break;
        }
      }
      if (modelBuildFile) {
        const resources = project.pbxResourcesBuildPhaseObj();
        resources.files = resources.files.filter(
          (file) => file.value !== modelBuildFile,
        );
        const sources = project.pbxSourcesBuildPhaseObj();
        if (!sources.files.some((file) => file.value === modelBuildFile)) {
          sources.files.push({
            value: modelBuildFile,
            comment: `${MODEL_NAME} in Sources`,
          });
        }
      }
    }

    return nextConfig;
  });
};
