// ============================================================
// CTRLpanel — transactional email via Resend
//
// All invite + confirmation emails go through here. The Resend SDK is
// plain fetch under the hood, so the same module runs in local Express
// dev AND the Cloudflare Worker (AGENTS.md rule 6).
//
// Env: RESEND_API_KEY (required), RESEND_FROM (optional sender override,
// defaults to Resend's shared onboarding sender for keyless testing).
// ============================================================
import { Resend } from 'resend';

// Lazily created so process.env is read at call time (Workers populate it
// on first request via nodejs_compat).
let _resend = null;
function resend() {
  if (_resend) return _resend;
  if (!process.env.RESEND_API_KEY) return null;
  _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

const FROM = () => process.env.RESEND_FROM || 'CTRLpanel <onboarding@resend.dev>';

// Minimal dark-themed shell matching the app's design system.
function shell(title, bodyHtml, cta) {
  const button = cta
    ? `<a href="${cta.url}" style="display:inline-block;margin-top:20px;padding:11px 22px;background:#e11d48;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">${cta.label}</a>`
    : '';
  return `
  <div style="background:#0a0808;padding:32px 16px;font-family:Inter,Helvetica,Arial,sans-serif">
    <div style="max-width:520px;margin:0 auto;background:#141010;border:1px solid #2a2020;border-radius:12px;padding:28px">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#8a7070;margin-bottom:14px">CTRLpanel</div>
      <div style="font-size:18px;font-weight:600;color:#f0e8e8;margin-bottom:10px">${title}</div>
      <div style="font-size:13px;line-height:1.6;color:#8a7070">${bodyHtml}</div>
      ${button}
      <div style="margin-top:24px;padding-top:14px;border-top:1px solid #1e1818;font-size:11px;color:#3d2e2e">
        Sent by CTRLpanel · by cwmccann.pro
      </div>
    </div>
  </div>`;
}

async function send(to, subject, html) {
  const client = resend();
  if (!client) throw new Error('Email is not configured on the server (RESEND_API_KEY).');
  const { error } = await client.emails.send({ from: FROM(), to, subject, html });
  if (error) throw new Error(`Resend: ${error.message || JSON.stringify(error)}`);
}

/**
 * Invite email with a tokenized accept link that routes back to the app
 * (`/invite/<token>`), where the backend resolves it for the signed-in user.
 * kind: 'board' → shared to-do list · 'friend' → nutrition friend request
 */
export async function sendInviteEmail({ to, inviterName, kind, boardName, token, appUrl }) {
  const link = `${appUrl}/invite/${encodeURIComponent(token)}`;
  const isBoard = kind === 'board';
  const subject = isBoard
    ? `${inviterName} shared the to-do list "${boardName}" with you`
    : `${inviterName} added you as a nutrition friend on CTRLpanel`;
  const body = isBoard
    ? `<strong style="color:#f0e8e8">${inviterName}</strong> invited you to collaborate on the to-do list
       <strong style="color:#f0e8e8">"${boardName}"</strong>. Accepting gives you full read/write access —
       changes sync live for everyone on the list.`
    : `<strong style="color:#f0e8e8">${inviterName}</strong> wants to connect on CTRLpanel Nutrition.
       Accepting creates a mutual friend connection so you can compare goal streaks on leaderboards
       and join challenges. Friends only ever see aggregate stats — never your food log.`;
  const note = `<p style="margin-top:14px">If you don't have a CTRLpanel account yet, register with this email address first — the invite resolves automatically after you sign in.</p>`;
  await send(to, subject, shell(subject, body + note, { url: link, label: isBoard ? 'Accept invite' : 'Accept friend request' }));
}

/** Confirmation back to the inviter once the recipient accepts. */
export async function sendAcceptedEmail({ to, accepterName, kind, boardName }) {
  const isBoard = kind === 'board';
  const subject = isBoard
    ? `${accepterName} joined "${boardName}"`
    : `${accepterName} accepted your nutrition friend request`;
  const body = isBoard
    ? `<strong style="color:#f0e8e8">${accepterName}</strong> accepted your invite to
       <strong style="color:#f0e8e8">"${boardName}"</strong>. The list is now shared — everyone's
       changes sync live.`
    : `<strong style="color:#f0e8e8">${accepterName}</strong> is now your nutrition friend.
       They'll show up on your leaderboard and can join your challenges.`;
  await send(to, subject, shell(subject, body));
}
