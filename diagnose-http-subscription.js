/**
 * Hit the actual HTTP endpoint that the frontend hits to fetch the subscription.
 *
 * This will tell us in one shot whether the bug is backend (404 / wrong filter /
 * null / wrapper shape mismatch) or frontend (request never goes out, unwrap
 * fails, etc.).
 *
 * Steps:
 *   1. POST /api/v1/auth/login as premium.test@email.com / password123 →
 *      capture accessToken.
 *   2. GET  /api/v1/subscriptions/tenant/<tenantId>  with that token.
 *   3. Print: HTTP status, full envelope, unwrapped `.data`, and the exact
 *      fields the frontend store inspects (id, status, end_date, plan code).
 *
 * Run with the backend already serving on http://localhost:9011.
 *   node diagnose-http-subscription.js
 */

const BASE = process.env.API_BASE || 'http://localhost:9011/api/v1';
const EMAIL = 'premium.test@email.com';
const PASSWORD = 'password123';

const isObj = (v) => v !== null && typeof v === 'object';

(async () => {
  // ── Step 1: login ──────────────────────────────────────────────────────────
  let loginRes, loginBody;
  try {
    loginRes = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    loginBody = await loginRes.json();
  } catch (e) {
    console.error('❌ Login request failed — is the backend running on', BASE, '?');
    console.error('  ', e.message);
    process.exit(1);
  }

  if (!loginRes.ok) {
    console.error('❌ Login failed:', loginRes.status, loginBody);
    process.exit(1);
  }

  // TransformInterceptor envelope: { success, data, statusCode, timestamp } OR raw
  const loginData = isObj(loginBody) && 'data' in loginBody ? loginBody.data : loginBody;
  const token = loginData?.accessToken;
  const userTenantId = loginData?.user?.tenantId;

  console.log('=== LOGIN RESPONSE ===');
  console.log('  HTTP status:        ', loginRes.status);
  console.log('  envelope has .data: ', isObj(loginBody) && 'data' in loginBody);
  console.log('  user.id:            ', loginData?.user?.id);
  console.log('  user.email:         ', loginData?.user?.email);
  console.log('  user.role:          ', loginData?.user?.role);
  console.log('  user.tenantId:      ', userTenantId);
  console.log('  user.tenant_id:     ', loginData?.user?.tenant_id, '  (should be undefined — snake_case leak)');
  console.log('  user.isPlatformAdmin:', loginData?.user?.isPlatformAdmin);
  console.log('  accessToken present:', token ? 'YES' : 'NO');

  if (!token || !userTenantId) {
    console.error('\n❌ Cannot continue — missing accessToken or tenantId in login response');
    console.error('   Full login body:', JSON.stringify(loginBody, null, 2));
    process.exit(1);
  }

  // ── Step 2: subscription fetch ─────────────────────────────────────────────
  const subUrl = `${BASE}/subscriptions/tenant/${userTenantId}`;
  console.log('\n=== GET', subUrl, '===');

  let subRes, subBody;
  try {
    subRes = await fetch(subUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await subRes.text();
    try {
      subBody = JSON.parse(text);
    } catch {
      subBody = text;
    }
  } catch (e) {
    console.error('❌ Subscription fetch failed:', e.message);
    process.exit(1);
  }

  console.log('  HTTP status:        ', subRes.status);
  console.log('  Content-Type:       ', subRes.headers.get('content-type'));

  if (typeof subBody !== 'object' || subBody === null) {
    console.error('  ⚠️ Non-JSON body:');
    console.error('  ', subBody);
    process.exit(1);
  }

  console.log('  envelope.success:   ', subBody.success);
  console.log('  envelope has .data: ', 'data' in subBody);
  console.log('  envelope.data null? ', subBody.data === null);

  // What the frontend unwraps:
  //   requestNoVersion: `return data.data !== undefined ? data.data : data`
  const unwrapped = subBody.data !== undefined ? subBody.data : subBody;

  console.log('\n=== UNWRAPPED (what subscriptionStore.fetchSubscription receives) ===');
  if (unwrapped === null) {
    console.log('  ❌ null  →  subscriptionStore sets hasSubscription = false  →  LOCK SCREEN');
  } else if (typeof unwrapped !== 'object') {
    console.log('  ❌ Non-object:', unwrapped);
  } else {
    console.log('  id:                ', unwrapped.id);
    console.log('  subscription_code: ', unwrapped.subscription_code);
    console.log('  status:            ', unwrapped.status);
    console.log('  start_date:        ', unwrapped.start_date);
    console.log('  end_date:          ', unwrapped.end_date);
    console.log('  auto_renew:        ', unwrapped.auto_renew);
    console.log('  tenant_id:         ', unwrapped.tenant_id);
    console.log('  plan_id:           ', unwrapped.plan_id);

    const plan = unwrapped.plans_subscriptions_plan_idToplans;
    console.log('  plan present?      ', plan ? 'YES' : 'NO');
    if (plan) {
      console.log('    plan.id:         ', plan.id);
      console.log('    plan.code:       ', plan.code);
      console.log('    plan.name:       ', plan.name);
    }
    console.log('  subscription_features count:', Array.isArray(unwrapped.subscription_features) ? unwrapped.subscription_features.length : 'N/A');

    // Replicate frontend store check (subscriptionStore.ts:99)
    const hasSub = !!(unwrapped && unwrapped.id && unwrapped.status);
    console.log('\n=== FRONTEND STORE CHECK ===');
    console.log('  hasSub = !!(sub && sub.id && sub.status)  →  ', hasSub);

    // Replicate UserLayout gate
    const status = unwrapped.status;
    const validStatus = ['ACTIVE', 'TRIAL', 'PAST_DUE'].includes((status || '').toUpperCase());
    const endDateValid = unwrapped.end_date ? new Date(unwrapped.end_date) >= new Date() : true;
    console.log('  isValidStatus(status)        →  ', validStatus);
    console.log('  isSubscriptionDateValid()    →  ', endDateValid);
    console.log('  shouldBlockContent (no/yes)  →  ', !(validStatus && endDateValid));
  }
})();
