function installPrivyWalletRoutes({ app, wallet, requireAuth, rateLimit }) {
  const status = (e) =>
    e.code === 'BAD_INPUT'
      ? 400
      : e.code === 'VERIFY'
        ? 409
        : e.code === 'NOT_SET_UP'
          ? 503
          : e.code === 'WALLET_STORE'
            ? 409
            : 502;
  app.get('/api/belna-wallet/config', async (_, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.json(await wallet.config());
    } catch (e) {
      res.status(status(e)).json({ error: e.message });
    }
  });
  app.get(
    '/api/belna-wallet/earn',
    rateLimit(20, 60000),
    requireAuth(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      try {
        res.json(await wallet.earn(req.user.id));
      } catch (e) {
        res.status(status(e)).json({ error: e.message });
      }
    }),
  );
  for (const action of ['prepare', 'authorize', 'cancel'])
    app.post(
      '/api/belna-wallet/' + action,
      rateLimit(10, 60000),
      requireAuth(async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
          const input = req.body || {},
            token = req.headers['privy-id-token'];
          res.json(
            action === 'prepare'
              ? await wallet.prepare(req.user.id, input, token)
              : action === 'authorize'
                ? await wallet.confirmTransfer(req.user.id, input, token)
                : await wallet.cancel(req.user.id, input),
          );
        } catch (e) {
          res.status(status(e)).json({ error: e.message });
        }
      }),
    );
}
export { installPrivyWalletRoutes };
