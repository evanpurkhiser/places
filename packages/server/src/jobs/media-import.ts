export const mediaImportQueueOptions = {
  policy: 'exclusive',
  retryLimit: 3,
  retryDelay: 10,
  retryBackoff: true,
  expireInSeconds: 900,
  deleteAfterSeconds: 7 * 24 * 60 * 60,
};
