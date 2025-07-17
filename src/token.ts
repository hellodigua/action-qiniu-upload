import qiniu from "qiniu";

export function genToken(
  bucket: string,
  ak: string,
  sk: string,
  key?: string
): string {
  const mac = new qiniu.auth.digest.Mac(ak, sk);

  const putPolicy = new qiniu.rs.PutPolicy({
    scope: key ? `${bucket}:${key}` : bucket,
  });
  const token = putPolicy.uploadToken(mac);
  return token;
}
