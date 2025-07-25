import * as core from '@actions/core';
import { upload } from './upload';

async function run(): Promise<void> {
  try {
    const ak = core.getInput('access_key');
    const sk = core.getInput('secret_key');
    const bucket = core.getInput('bucket');
    const sourceDir = core.getInput('source_dir');
    const destDir = core.getInput('dest_dir');
    const overwrite = core.getInput('overwrite') === 'true';
    const ignoreSourceMap = core.getInput('ignore_source_map') === 'true';
    const cdnDomain = core.getInput('cdn_domain');

    upload(
      ak,
      sk,
      bucket,
      sourceDir,
      destDir,
      overwrite,
      ignoreSourceMap,
      cdnDomain,
      (file, key) => core.info(`Success: ${file} => [${bucket}]: ${key}`),
      () => core.info('Done!'),
      (error) => core.setFailed(error.message),
    );
  } catch (error: any) {
    core.setFailed(error.message);
  }
}

run();
