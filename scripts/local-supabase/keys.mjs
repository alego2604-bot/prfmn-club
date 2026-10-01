// Genera las claves JWT (anon / service_role) del stack local a partir del secreto. Solo desarrollo.
import { createHmac } from "node:crypto";
const secret = process.argv[2];
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sign = (role) => {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const p = b64({ iss: "supabase-local", role, iat: 1700000000, exp: 2000000000 });
  return `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
};
console.log(`ANON_KEY=${sign("anon")}\nSERVICE_ROLE_KEY=${sign("service_role")}`);
