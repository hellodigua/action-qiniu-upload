import qiniu from 'qiniu';
import path from 'path';
import glob from 'glob';
import pAll from 'p-all';
import pRetry from 'p-retry';
import { genToken } from './token';

function normalizePath(input: string): string {
  return input.replace(/^\//, '');
}

function refreshHtmlFiles(
  ak: string,
  sk: string,
  cdnDomain: string,
  htmlFiles: string[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!cdnDomain || htmlFiles.length === 0) {
      return resolve();
    }

    const mac = new qiniu.auth.digest.Mac(ak, sk);
    const cdnManager = new qiniu.cdn.CdnManager(mac);
    
    const urlsToRefresh = htmlFiles.map(file => `${cdnDomain}/${file}`);
    
    cdnManager.refreshUrls(urlsToRefresh, (err, respBody, respInfo) => {
      if (err) {
        return reject(err);
      }
      
      if (respInfo.statusCode === 200) {
        htmlFiles.forEach(file => {
          console.log(`${file} 刷新成功`);
        });
        resolve();
      } else {
        reject(new Error(`CDN刷新失败，状态码: ${respInfo.statusCode}`));
      }
    });
  });
}

export function upload(
  ak: string,
  sk: string,
  bucket: string,
  srcDir: string,
  destDir: string,
  overwrite: boolean,
  ignoreSourceMap: boolean,
  cdnDomain: string,
  onProgress: (srcFile: string, destFile: string) => void,
  onComplete: () => void,
  onFail: (errorInfo: any) => void,
): void {
  const baseDir = path.resolve(process.cwd(), srcDir);
  const files = glob.sync(`${baseDir}/**/*`, { nodir: true });

  const config = new qiniu.conf.Config();
  const uploader = new qiniu.form_up.FormUploader(config);

  const htmlFiles: string[] = [];

  const tasks = files
    .map((file) => {
      const relativePath = path.relative(baseDir, path.dirname(file));
      const key = normalizePath(
        path.join(destDir, relativePath, path.basename(file)),
      );

      if (ignoreSourceMap && file.endsWith('.map')) return null;

      if (file.endsWith('.html')) {
        htmlFiles.push(key);
      }

      const task = (): Promise<any> => new Promise((resolve, reject) => {
        const token = overwrite
          ? genToken(bucket, ak, sk, key)
          : genToken(bucket, ak, sk);

        const putExtra = new qiniu.form_up.PutExtra();
        uploader.putFile(token, key, file, putExtra, (err, body, info) => {
          const fileInfo = `file: ${file}, key: ${key}, overwrite: ${overwrite}`;

          if (err) {
            const errorMessage = `Upload failed - ${fileInfo}, error: ${err.message || err}, stack: ${err.stack || 'no stack'}`;
            return reject(new Error(errorMessage));
          }

          if (!info || typeof info.statusCode === 'undefined') {
            const errorMessage = `Upload failed - ${fileInfo}, reason: no response info received`;
            return reject(new Error(errorMessage));
          }

          if (info.statusCode === 200) {
            onProgress(file, key);
            return resolve({ file, to: key });
          }

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

  pAll(tasks, { concurrency: 5 })
    .then(async () => {
      if (htmlFiles.length > 0) {
        try {
          await refreshHtmlFiles(ak, sk, cdnDomain, htmlFiles);
        } catch (error) {
          console.error('HTML文件刷新失败:', error);
        }
      }
      onComplete();
    })
    .catch(onFail);
}
