import qiniu from 'qiniu';
import path from 'path';
import glob from 'glob';
import pAll from 'p-all';
import pRetry from 'p-retry';
import { genToken } from './token';

function normalizePath(input: string): string {
  return input.replace(/^\//, '');
}

export function upload(
  ak: string,
  sk: string,
  bucket: string,
  srcDir: string,
  destDir: string,
  overwrite: boolean,
  ignoreSourceMap: boolean,
  onProgress: (srcFile: string, destFile: string) => void,
  onComplete: () => void,
  onFail: (errorInfo: any) => void,
): void {
  const baseDir = path.resolve(process.cwd(), srcDir);
  const files = glob.sync(`${baseDir}/**/*`, { nodir: true });

  const config = new qiniu.conf.Config();
  const uploader = new qiniu.form_up.FormUploader(config);

  const tasks = files
    .map((file) => {
      const relativePath = path.relative(baseDir, path.dirname(file));
      const key = normalizePath(
        path.join(destDir, relativePath, path.basename(file)),
      );

      if (ignoreSourceMap && file.endsWith('.map')) return null;

      const task = (): Promise<any> => new Promise((resolve, reject) => {
        // 根据是否覆盖生成不同的token
        const token = overwrite
          ? genToken(bucket, ak, sk, key)
          : genToken(bucket, ak, sk);

        const putExtra = new qiniu.form_up.PutExtra();
        uploader.putFile(token, key, file, putExtra, (err, body, info) => {
          // 构建详细的错误信息
          const fileInfo = `file: ${file}, key: ${key}, overwrite: ${overwrite}`;

          if (err) {
            const errorMessage = `Upload failed - ${fileInfo}, error: ${err.message || err}, stack: ${err.stack || 'no stack'}`;
            return reject(new Error(errorMessage));
          }

          // 检查HTTP状态码
          if (!info || typeof info.statusCode === 'undefined') {
            const errorMessage = `Upload failed - ${fileInfo}, reason: no response info received`;
            return reject(new Error(errorMessage));
          }

          if (info.statusCode === 200) {
            onProgress(file, key);
            return resolve({ file, to: key });
          }

          // 其他状态码的详细错误信息
          let errorDetails = '';
          if (body) {
            try {
              const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
              errorDetails = `, response body: ${bodyStr}`;
            } catch (e) {
              errorDetails = ', response body: [unable to serialize]';
            }
          }

          const errorMessage = `Upload failed - ${fileInfo}, status code: ${info.statusCode}${errorDetails}`;
          reject(new Error(errorMessage));
        });
      });

      return () => pRetry(task, { retries: 3 });
    })
    .filter((item) => !!item) as (() => Promise<any>)[];

  pAll(tasks, { concurrency: 5 }).then(onComplete).catch(onFail);
}
