// ============================================================================
// NOTIFICATIONS - In-app + optional email (SMTP)
// All methods are fire-and-forget (never block the API response)
// ============================================================================

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;

  try {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: (process.env.SMTP_PORT || '587') === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
    console.log('Email notifications: configured');
    return transporter;
  } catch (e) {
    console.log('Email notifications: nodemailer not available -', e.message);
    return null;
  }
}

const FROM = () => process.env.SMTP_FROM || 'Noralta Transaction Master <noreply@noralta.ca>';

async function sendEmail(to, subject, html) {
  const t = getTransporter();
  if (!t) return;
  try {
    await t.sendMail({ from: FROM(), to, subject, html });
    console.log(`Email sent: "${subject}" → ${to}`);
  } catch (e) {
    console.error(`Email failed: "${subject}" → ${to}:`, e.message);
  }
}

// ============================================================================
// IN-APP NOTIFICATION HELPER
// ============================================================================

async function createInAppNotification(pool, agentId, type, title, body, dealId) {
  try {
    await pool.query(
      'INSERT INTO app_notifications (agent_id, type, title, body, deal_id) VALUES ($1,$2,$3,$4,$5)',
      [agentId, type, title, body, dealId || null]
    );
  } catch (e) {
    console.error('In-app notification error:', e.message);
  }
}

// Get broker/broker_owner agent IDs for notifications
async function getBrokerAgentIds(pool) {
  try {
    const result = await pool.query(
      "SELECT id FROM agents WHERE role IN ('broker', 'broker_owner', 'admin') AND password_hash IS NOT NULL"
    );
    return result.rows.map(r => r.id);
  } catch {
    return [];
  }
}

// ============================================================================
// NOTIFICATION EVENTS (all fire-and-forget)
// ============================================================================

// Deal status changed
function onStatusChange(pool, dealId, agent, oldStatus, newStatus) {
  getDealContext(pool, dealId).then(async ctx => {
    if (!ctx) return;
    const addr = ctx.address || `Deal #${dealId}`;

    // In-app: notify the deal's agent
    await createInAppNotification(
      pool, agent.agent_id, 'status_change',
      `${addr} → ${newStatus}`,
      `Status changed from ${oldStatus} to ${newStatus}`,
      dealId
    );

    // In-app: notify brokers on firm/closed
    if (newStatus === 'firm' || newStatus === 'closed') {
      const brokerIds = await getBrokerAgentIds(pool);
      for (const bId of brokerIds) {
        if (bId === agent.agent_id) continue;
        await createInAppNotification(
          pool, bId, 'status_change',
          `${addr} → ${newStatus}`,
          `${agent.full_name} changed status from ${oldStatus} to ${newStatus}`,
          dealId
        );
      }
    }

    // Email (optional)
    if (getTransporter()) {
      const subject = `Deal #${dealId} - Status: ${newStatus}`;
      const html = `
        <h2>Deal Status Changed</h2>
        <p><strong>${addr}</strong></p>
        <p>Status changed from <strong>${oldStatus}</strong> to <strong>${newStatus}</strong></p>
        <p>Changed by: ${agent.full_name}</p>
        <p>Date: ${new Date().toLocaleDateString('en-CA')}</p>
      `;
      if (agent.email) sendEmail(agent.email, subject, html);
    }
  }).catch(() => {});
}

// Deal handed off to another agent
function onHandoff(pool, dealId, fromAgent, toAgent, notes) {
  getDealContext(pool, dealId).then(async ctx => {
    if (!ctx) return;
    const addr = ctx.address || `Deal #${dealId}`;

    // In-app: notify receiving agent
    await createInAppNotification(
      pool, toAgent.id, 'handoff',
      `${addr} transferred to you`,
      `${fromAgent.full_name} transferred this deal to you${notes ? '. Notes: ' + notes : ''}`,
      dealId
    );

    // In-app: notify sending agent
    await createInAppNotification(
      pool, fromAgent.agent_id, 'handoff',
      `${addr} transferred to ${toAgent.full_name}`,
      `You transferred this deal to ${toAgent.full_name}`,
      dealId
    );

    // Email (optional)
    if (getTransporter()) {
      const subject = `Deal #${dealId} transferred to you`;
      const html = `
        <h2>Deal Handoff</h2>
        <p><strong>${addr}</strong></p>
        <p>Transferred from <strong>${fromAgent.full_name}</strong> to <strong>${toAgent.full_name}</strong></p>
        ${notes ? `<p>Notes: ${notes}</p>` : ''}
        <p>Date: ${new Date().toLocaleDateString('en-CA')}</p>
        <p>Log in to view this deal: <a href="https://noralta-transaction-master.vercel.app">Noralta Transaction Master</a></p>
      `;
      if (toAgent.email) sendEmail(toAgent.email, subject, html);
      if (fromAgent.email) {
        sendEmail(fromAgent.email, `Deal #${dealId} transferred to ${toAgent.full_name}`, html);
      }
    }
  }).catch(() => {});
}

// Form completed (100% progress) — notify brokers
function onFormMilestone(pool, dealId, formCode, formName, agentId, agentName) {
  (async () => {
    try {
      const ctx = await getDealContext(pool, dealId);
      const addr = ctx?.address || `Deal #${dealId}`;

      const brokerIds = await getBrokerAgentIds(pool);
      for (const bId of brokerIds) {
        await createInAppNotification(
          pool, bId, 'form_complete',
          `${formName} completed`,
          `${agentName} completed ${formName} for ${addr}`,
          dealId
        );
      }
    } catch (e) {
      console.error('Form milestone notification error:', e.message);
    }
  })();
}

// Helper: get deal context
async function getDealContext(pool, dealId) {
  try {
    const result = await pool.query(
      `SELECT t.id, t.status, t.transaction_type, t.agent_id, p.address, p.city
       FROM transactions t LEFT JOIN properties p ON p.id = t.property_id
       WHERE t.id = $1`, [dealId]
    );
    return result.rows[0] || null;
  } catch {
    return null;
  }
}

// Password reset email
function sendResetEmail(email, name, resetUrl) {
  if (!getTransporter()) return;
  const subject = 'Password Reset - Noralta Transaction Master';
  const html = `
    <h2>Password Reset</h2>
    <p>Hi ${name},</p>
    <p>Click the link below to reset your password. This link expires in 1 hour.</p>
    <p><a href="${resetUrl}" style="background:#EA002A;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:bold">Reset Password</a></p>
    <p>If you didn't request this, you can ignore this email.</p>
  `;
  sendEmail(email, subject, html);
}

module.exports = { onStatusChange, onHandoff, onFormMilestone, createInAppNotification, sendResetEmail };
