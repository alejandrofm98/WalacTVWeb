import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

admin.initializeApp();

// Callable function to promote a user to admin by UID
export const promoteAdmin = functions.https.onCall(async (data, context) => {
  // Authed caller must exist
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const callerClaims = context.auth.token || {} as any;
  if (!callerClaims.admin) {
    throw new functions.https.HttpsError('permission-denied', 'Only admins can promote others.');
  }

  const targetUid = data?.uid;
  if (!targetUid) {
    throw new functions.https.HttpsError('invalid-argument', 'uid is required.');
  }

  try {
    await admin.auth().setCustomUserClaims(targetUid, { admin: true });
    return { success: true, uid: targetUid };
  } catch (error) {
    throw new functions.https.HttpsError('internal', 'Failed to set admin claims.');
  }
});

// HTTP endpoint alternative to promote admin (requires Authorization header with Firebase ID token)
export const promoteAdminHttp = functions.https.onRequest(async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const tokenMatch = authHeader.match(/^Bearer (.*)$/);
    if (!tokenMatch) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }
    const idToken = tokenMatch[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    if (!decoded.admin) {
      res.status(403).send({ error: 'Not admin' });
      return;
    }

    const targetUid = req.body?.uid;
    if (!targetUid) {
      res.status(400).send({ error: 'uid required' });
      return;
    }
    await admin.auth().setCustomUserClaims(targetUid, { admin: true });
    res.json({ success: true, uid: targetUid });
  } catch (err) {
    res.status(500).send({ error: 'Internal error' });
  }
});
