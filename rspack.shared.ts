import type { Configuration } from "@rspack/core";
import { resolve } from "node:path";

export type CreateRspackConfigOptions = {
  rootDir: string;
  outPath: string;
  outFileName: string;
  mode?: "development" | "production";
};

export function createRspackConfig({
  rootDir,
  outPath,
  outFileName,
  mode = "production",
}: CreateRspackConfigOptions): Configuration {
  const isProduction = mode === "production";

  return {
    mode,
    entry: `${rootDir}/src/index.ts`,
    target: "web",
    devtool: isProduction ? false : "inline-source-map",
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          exclude: /node_modules/,
          enforce: "pre",
          use: [
            {
              loader: resolve(rootDir, "build/console-location-loader.cjs"),
            },
          ],
        },
        {
          test: /\.tsx?$/,
          exclude: /node_modules/,
          loader: "builtin:swc-loader",
          options: {
            jsc: {
              parser: {
                syntax: "typescript",
              },
              target: "es2019",
            },
          },
        },
      ],
    },
    resolve: {
      extensions: [".ts", ".tsx", ".mjs", ".js", ".json"],
    },
    output: {
      path: outPath,
      filename: outFileName,
      library: {
        type: "commonjs2",
      },
    },
    optimization: {
      minimize: true,
      usedExports: true,
      sideEffects: true,
      concatenateModules: true,
    },
  };
}
