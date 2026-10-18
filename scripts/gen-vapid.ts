// Generate a VAPID key pair for Web Push (SPEC §9.6). Owned by B5 (BUILD_PLAN §3.5);
// F ships this minimal version. Paste the output into .env.local / your host's env.
import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log("VAPID_SUBJECT=mailto:you@example.com");
