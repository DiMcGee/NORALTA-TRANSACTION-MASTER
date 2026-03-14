// ============================================================================
// NOTIFICATION ROUTES - 4 endpoints for in-app notifications
// All require auth (applied by parent router mounting)
// ============================================================================

const express = require('express');
const router = express.Router();

module.exports = function (pool) {
  // ========================================================================
  // GET /api/notifications - List notifications for current agent
  // ========================================================================
  router.get('/notifications', async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, type, title, body, deal_id, read, created_at
         FROM app_notifications
         WHERE agent_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [req.agent.agent_id]
      );

      const countResult = await pool.query(
        'SELECT COUNT(*) FROM app_notifications WHERE agent_id = $1 AND read = FALSE',
        [req.agent.agent_id]
      );

      res.json({
        notifications: result.rows,
        unreadCount: parseInt(countResult.rows[0].count)
      });
    } catch (e) {
      console.error('Notifications list error:', e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========================================================================
  // GET /api/notifications/unread-count - Lightweight badge poll
  // ========================================================================
  router.get('/notifications/unread-count', async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT COUNT(*) FROM app_notifications WHERE agent_id = $1 AND read = FALSE',
        [req.agent.agent_id]
      );
      res.json({ unreadCount: parseInt(result.rows[0].count) });
    } catch (e) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========================================================================
  // PUT /api/notifications/:id/read - Mark one notification read
  // ========================================================================
  router.put('/notifications/:id/read', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid notification ID' });
      const result = await pool.query(
        'UPDATE app_notifications SET read = TRUE WHERE id = $1 AND agent_id = $2 RETURNING id',
        [id, req.agent.agent_id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Notification not found' });
      }
      res.json({ message: 'Marked as read' });
    } catch (e) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========================================================================
  // PUT /api/notifications/read-all - Mark all read for current agent
  // ========================================================================
  router.put('/notifications/read-all', async (req, res) => {
    try {
      const result = await pool.query(
        'UPDATE app_notifications SET read = TRUE WHERE agent_id = $1 AND read = FALSE',
        [req.agent.agent_id]
      );
      res.json({ message: 'All marked as read', count: result.rowCount });
    } catch (e) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
