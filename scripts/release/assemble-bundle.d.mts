export type BundleArch = 'amd64' | 'arm64';

export type AssembleBundleInput = {
  arch: BundleArch;
  image: string;
  tag: string;
  repo: string;
  tarPath: string;
  outDir: string;
  templatesDir: string;
  composePath?: string;
};

export type AssembleBundleResult = {
  bundleName: string;
  stagingDir: string;
  zipPath: string;
};

export function assembleBundle(input: AssembleBundleInput): Promise<AssembleBundleResult>;
