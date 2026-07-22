const API_VERSION = 'v2';
const LOCK_TIMEOUT_MS = 10000;
const MAX_PAGE_SIZE = 500;
const ROUND_PROPERTY_PREFIX = 'estimationPoker.round.';
const AUTH_SUBJECT_PROPERTY_PREFIX = 'estimationPoker.auth.subject.';
const AUTH_MEMBER_PROPERTY_PREFIX = 'estimationPoker.auth.member.';
const AUTH_SESSION_SECRET_PROPERTY = 'ESTIMATION_POKER_SESSION_SECRET';
const GOOGLE_CLIENT_ID_PROPERTY = 'GOOGLE_CLIENT_ID';
const GOOGLE_CLIENT_SECRET_PROPERTY = 'GOOGLE_CLIENT_SECRET';
const GOOGLE_ALLOWED_ORIGINS_PROPERTY = 'GOOGLE_ALLOWED_ORIGINS';
const GOOGLE_ALLOWED_DOMAIN_PROPERTY = 'GOOGLE_ALLOWED_DOMAIN';
const AUTH_SESSION_TTL_SECONDS = 2 * 60 * 60;
const AUTH_CLOCK_SKEW_SECONDS = 60;
const VOTE_VALUES = [0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 40];

const SESSION_STATUSES = ['draft', 'active', 'completed', 'cancelled'];
const TICKET_STATUSES = ['pending', 'voting', 'revealed', 'estimated', 'skipped'];
const MEMBER_ROLES = ['member', 'facilitator'];

const SHEETS = {
  teams: {
    sheetName: 'Teams',
    required: ['name'],
    fields: ['id', 'name', 'jiraBaseUrl', 'jiraProjectKey', 'createdAt', 'active'],
    createFields: ['name', 'jiraBaseUrl', 'jiraProjectKey', 'active'],
    updateFields: ['name', 'jiraBaseUrl', 'jiraProjectKey', 'active']
  },
  teamMembers: {
    sheetName: 'TeamMembers',
    required: ['teamId', 'displayName'],
    fields: ['id', 'teamId', 'displayName', 'email', 'role', 'active', 'createdAt'],
    createFields: ['teamId', 'displayName', 'email', 'role', 'active'],
    updateFields: ['displayName', 'email', 'role', 'active']
  },
  estimationSessions: {
    sheetName: 'EstimationSessions',
    required: ['teamId', 'name', 'createdByMemberId'],
    fields: [
      'id', 'teamId', 'name', 'status', 'createdByMemberId',
      'createdAt', 'startedAt', 'completedAt', 'currentTicketId'
    ],
    createFields: ['teamId', 'name', 'createdByMemberId'],
    updateFields: ['name', 'status', 'startedAt', 'completedAt', 'currentTicketId']
  },
  estimationTickets: {
    sheetName: 'EstimationTickets',
    required: ['sessionId', 'jiraIssueKey', 'summary'],
    fields: [
      'id', 'sessionId', 'jiraIssueKey', 'summary', 'description',
      'status', 'sortOrder', 'finalEstimateHours', 'createdAt'
    ],
    createFields: ['sessionId', 'jiraIssueKey', 'summary', 'description', 'sortOrder'],
    updateFields: ['jiraIssueKey', 'summary', 'description', 'status', 'sortOrder']
  },
  votes: {
    sheetName: 'Votes',
    required: [
      'sessionId', 'ticketId', 'teamMemberId',
      'roundNumber', 'estimateHours'
    ],
    fields: [
      'id', 'sessionId', 'ticketId', 'teamMemberId',
      'roundNumber', 'estimateHours', 'createdAt'
    ],
    createFields: [],
    updateFields: []
  }
};

function doGet(e) {
  return handleRequest_('GET', e);
}

function doPost(e) {
  return handleRequest_('POST', e);
}

function handleRequest_(method, e) {
  try {
    const params = (e && e.parameter) || {};
    const body = parseBody_(e);
    const action = cleanString_(params.action || body.action, 50);

    if (!action) {
      return jsonResponse_({
        ok: true,
        data: {
          apiVersion: API_VERSION,
          endpoints: [
            'GET  ?action=health',
            'POST action=authenticate',
            'POST action=me',
            'POST action=list',
            'POST action=get',
            'POST action=create',
            'POST action=update',
            'POST action=delete',
            'POST action=sessionState',
            'POST action=submitVote',
            'POST action=revealTicket',
            'POST action=finalizeTicket'
          ]
        }
      });
    }

    switch (action) {
      case 'health':
        return jsonResponse_({
          ok: true,
          data: {
            apiVersion: API_VERSION,
            timestamp: nowIso_()
          }
        });

      case 'authenticate':
        requirePost_(method);
        return jsonResponse_(authenticateGoogle_(body));
    }

    requirePost_(method);
    const actor = authenticateSession_(body.authToken);

    switch (action) {
      case 'me':
        return jsonResponse_({ ok: true, data: publicActor_(actor) });

      case 'list':
        return jsonResponse_(listEntities_(
          actor,
          body.entity,
          body.filters || {}
        ));

      case 'get':
        return jsonResponse_(getEntity_(
          actor,
          body.entity,
          body.id
        ));

      case 'create':
        return jsonResponse_(withScriptLock_(function() {
          return createEntity_(actor, body.entity, body.data || {});
        }));

      case 'update':
        return jsonResponse_(withScriptLock_(function() {
          return updateEntity_(actor, body.entity, body.id, body.data || {});
        }));

      case 'delete':
        return jsonResponse_(withScriptLock_(function() {
          return deleteEntity_(actor, body.entity, body.id);
        }));

      case 'sessionState':
        return jsonResponse_(getSessionState_(
          actor,
          body.sessionId
        ));

      case 'submitVote':
        return jsonResponse_(withScriptLock_(function() {
          return submitVote_(actor, body);
        }));

      case 'revealTicket':
        return jsonResponse_(withScriptLock_(function() {
          return revealTicket_(actor, body);
        }));

      case 'finalizeTicket':
        return jsonResponse_(withScriptLock_(function() {
          return finalizeTicket_(actor, body);
        }));

      default:
        throw new ApiError_('UNKNOWN_ACTION', 'Unknown action: ' + action, 400);
    }
  } catch (error) {
    const isApiError = error && error.name === 'ApiError';
    if (!isApiError || error.status >= 500) {
      console.error(error && error.stack ? error.stack : error);
    }

    return jsonResponse_({
      ok: false,
      error: {
        code: isApiError ? error.code : 'INTERNAL_ERROR',
        message: isApiError ? error.message : 'An internal server error occurred.',
        status: isApiError ? error.status : 500
      }
    });
  }
}

function authenticateGoogle_(body) {
  assertPlainObject_(body, 'body');
  const code = requiredString_(body.code, 'code', 4096);
  const redirectOrigin = requiredString_(body.redirectOrigin, 'redirectOrigin', 500);
  const properties = PropertiesService.getScriptProperties();
  const clientId = requiredConfiguration_(properties, GOOGLE_CLIENT_ID_PROPERTY);
  const clientSecret = requiredConfiguration_(properties, GOOGLE_CLIENT_SECRET_PROPERTY);
  const allowedOrigins = requiredConfiguration_(properties, GOOGLE_ALLOWED_ORIGINS_PROPERTY)
    .split(',')
    .map(function(value) { return value.trim().replace(/\/$/, ''); })
    .filter(Boolean);
  const normalizedOrigin = redirectOrigin.replace(/\/$/, '');

  if (allowedOrigins.indexOf(normalizedOrigin) === -1) {
    throw new ApiError_('ORIGIN_NOT_ALLOWED', 'This application origin is not allowed to sign in', 403);
  }

  const tokenResponse = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: {
      code: code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: normalizedOrigin,
      grant_type: 'authorization_code'
    },
    muteHttpExceptions: true
  });
  if (tokenResponse.getResponseCode() !== 200) {
    throw new ApiError_('GOOGLE_AUTH_FAILED', 'Google could not verify this sign-in attempt', 401);
  }
  const tokens = parseExternalJson_(tokenResponse, 'Google token response');
  const accessToken = requiredString_(tokens.access_token, 'access_token', 8192);
  const idClaims = decodeJwtPayload_(tokens.id_token);
  validateGoogleIdClaims_(idClaims, clientId);

  const profileResponse = UrlFetchApp.fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    method: 'get',
    headers: { Authorization: 'Bearer ' + accessToken },
    muteHttpExceptions: true
  });
  if (profileResponse.getResponseCode() !== 200) {
    throw new ApiError_('GOOGLE_AUTH_FAILED', 'Google could not return the signed-in profile', 401);
  }
  const profile = parseExternalJson_(profileResponse, 'Google profile response');
  if (!profile.sub || !sameId_(profile.sub, idClaims.sub) || !sameEmail_(profile.email, idClaims.email)) {
    throw new ApiError_('GOOGLE_AUTH_FAILED', 'Google returned inconsistent identity information', 401);
  }
  if (!toBoolean_(profile.email_verified) || !toBoolean_(idClaims.email_verified)) {
    throw new ApiError_('EMAIL_NOT_VERIFIED', 'A verified Google email address is required', 403);
  }

  const allowedDomain = cleanString_(properties.getProperty(GOOGLE_ALLOWED_DOMAIN_PROPERTY), 255).toLowerCase();
  if (allowedDomain && String(idClaims.hd || '').toLowerCase() !== allowedDomain) {
    throw new ApiError_('DOMAIN_NOT_ALLOWED', 'Use an account from the allowed Google Workspace domain', 403);
  }

  const actor = withScriptLock_(function() {
    return bindGoogleIdentity_({
      sub: requiredString_(profile.sub, 'sub', 255),
      email: requiredString_(profile.email, 'email', 320).toLowerCase()
    });
  });
  const session = issueSessionToken_(actor);
  return {
    ok: true,
    data: {
      token: session.token,
      expiresAt: session.expiresAt,
      user: publicActor_(actor)
    }
  };
}

function validateGoogleIdClaims_(claims, clientId) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const audienceMatches = Array.isArray(claims.aud)
    ? claims.aud.indexOf(clientId) !== -1
    : sameId_(claims.aud, clientId);
  if (!audienceMatches || ['accounts.google.com', 'https://accounts.google.com'].indexOf(claims.iss) === -1) {
    throw new ApiError_('GOOGLE_AUTH_FAILED', 'The Google identity token is not intended for this application', 401);
  }
  if (!claims.sub || !claims.email || Number(claims.exp) < nowSeconds - AUTH_CLOCK_SKEW_SECONDS) {
    throw new ApiError_('GOOGLE_AUTH_FAILED', 'The Google identity token is invalid or expired', 401);
  }
}

function bindGoogleIdentity_(profile) {
  const properties = PropertiesService.getScriptProperties();
  const subjectKey = AUTH_SUBJECT_PROPERTY_PREFIX + profile.sub;
  const existingIds = parsePropertyArray_(properties.getProperty(subjectKey));
  const members = readRows_('TeamMembers');
  const invitations = members.filter(function(member) {
    return toBoolean_(member.active) && sameEmail_(member.email, profile.email);
  });
  const conflictingInvitation = invitations.find(function(member) {
    const boundSubject = properties.getProperty(AUTH_MEMBER_PROPERTY_PREFIX + member.id);
    return boundSubject && !sameId_(boundSubject, profile.sub);
  });
  if (conflictingInvitation) {
    throw new ApiError_('ACCOUNT_ALREADY_LINKED', 'This invitation is already linked to another Google account', 403);
  }

  const memberIds = existingIds.slice();
  invitations.forEach(function(member) {
    const memberKey = AUTH_MEMBER_PROPERTY_PREFIX + member.id;
    const boundSubject = properties.getProperty(memberKey);
    if (!boundSubject) properties.setProperty(memberKey, profile.sub);
    if (memberIds.indexOf(String(member.id)) === -1) memberIds.push(String(member.id));
  });

  if (!memberIds.length) {
    throw new ApiError_(
      'REGISTRATION_REQUIRED',
      'No active team-member invitation matches this Google email address',
      403
    );
  }
  properties.setProperty(subjectKey, JSON.stringify(memberIds));
  return actorForSubject_(profile.sub, profile.email);
}

function issueSessionToken_(actor) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    sub: actor.sub,
    email: actor.email,
    iat: nowSeconds,
    exp: nowSeconds + AUTH_SESSION_TTL_SECONDS
  };
  const encodedPayload = base64UrlEncodeString_(JSON.stringify(payload));
  const signature = signSessionPayload_(encodedPayload);
  return {
    token: encodedPayload + '.' + signature,
    expiresAt: payload.exp * 1000
  };
}

function authenticateSession_(token) {
  if (token === undefined || token === null || String(token).trim() === '') {
    throw new ApiError_('AUTH_REQUIRED', 'Sign in to continue', 401);
  }
  const normalizedToken = requiredString_(token, 'authToken', 16384);
  const parts = normalizedToken.split('.');
  if (parts.length !== 2 || !constantTimeEquals_(signSessionPayload_(parts[0]), parts[1])) {
    throw new ApiError_('INVALID_SESSION', 'The sign-in session is invalid', 401);
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecodeString_(parts[0]));
  } catch (error) {
    throw new ApiError_('INVALID_SESSION', 'The sign-in session is invalid', 401);
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.v !== 1 || !payload.sub || !payload.email || !Number.isFinite(Number(payload.exp))) {
    throw new ApiError_('INVALID_SESSION', 'The sign-in session is invalid', 401);
  }
  if (Number(payload.exp) < nowSeconds - AUTH_CLOCK_SKEW_SECONDS) {
    throw new ApiError_('SESSION_EXPIRED', 'The sign-in session has expired', 401);
  }
  if (Number(payload.iat) > nowSeconds + AUTH_CLOCK_SKEW_SECONDS) {
    throw new ApiError_('INVALID_SESSION', 'The sign-in session is invalid', 401);
  }
  return actorForSubject_(String(payload.sub), String(payload.email).toLowerCase());
}

function actorForSubject_(subject, email) {
  const properties = PropertiesService.getScriptProperties();
  const memberIds = parsePropertyArray_(properties.getProperty(AUTH_SUBJECT_PROPERTY_PREFIX + subject));
  const members = readRows_('TeamMembers').filter(function(member) {
    return memberIds.indexOf(String(member.id)) !== -1 &&
      sameId_(properties.getProperty(AUTH_MEMBER_PROPERTY_PREFIX + member.id), subject) &&
      toBoolean_(member.active);
  });
  if (!members.length) {
    throw new ApiError_('MEMBERSHIP_REQUIRED', 'This Google account has no active team membership', 403);
  }
  const seenTeams = {};
  members.forEach(function(member) {
    const teamKey = String(member.teamId);
    if (seenTeams[teamKey]) {
      throw new ApiError_('AMBIGUOUS_MEMBERSHIP', 'This Google account has multiple active memberships for the same team', 409);
    }
    seenTeams[teamKey] = true;
  });
  return { sub: subject, email: email, memberships: members };
}

function publicActor_(actor) {
  const firstMembership = actor.memberships[0];
  return {
    email: actor.email,
    displayName: firstMembership.displayName || actor.email,
    memberships: actor.memberships.map(function(member) {
      return {
        memberId: member.id,
        teamId: member.teamId,
        displayName: member.displayName,
        role: member.role
      };
    })
  };
}

function findMembership_(actor, teamId) {
  return actor.memberships.find(function(member) {
    return sameId_(member.teamId, teamId) && toBoolean_(member.active);
  }) || null;
}

function requireTeamMembership_(actor, teamId) {
  const normalizedTeamId = requiredString_(teamId, 'teamId', 200);
  const membership = findMembership_(actor, normalizedTeamId);
  if (!membership) throw new ApiError_('FORBIDDEN', 'You do not have access to this team', 403);
  return membership;
}

function requireFacilitator_(actor, teamId) {
  const membership = requireTeamMembership_(actor, teamId);
  if (membership.role !== 'facilitator') {
    throw new ApiError_('FACILITATOR_REQUIRED', 'Facilitator permission is required for this action', 403);
  }
  return membership;
}

function authorizeEntityRead_(actor, entityName, record) {
  if (entityName === 'teams' || entityName === 'teamMembers') {
    requireTeamMembership_(actor, entityName === 'teams' ? record.id : record.teamId);
    return;
  }
  if (entityName === 'estimationSessions') {
    requireTeamMembership_(actor, record.teamId);
    return;
  }
  if (entityName === 'estimationTickets') {
    const session = findById_('EstimationSessions', record.sessionId);
    if (!session) throw new ApiError_('SESSION_NOT_FOUND', 'Session not found', 404);
    requireTeamMembership_(actor, session.teamId);
    return;
  }
  throw new ApiError_('FORBIDDEN', 'This entity cannot be read directly', 403);
}

function authorizeEntityMutation_(actor, entityName, record) {
  if (entityName === 'estimationSessions') {
    requireFacilitator_(actor, record.teamId);
    return;
  }
  if (entityName === 'estimationTickets') {
    const session = findById_('EstimationSessions', record.sessionId);
    if (!session) throw new ApiError_('SESSION_NOT_FOUND', 'Session not found', 404);
    requireFacilitator_(actor, session.teamId);
    return;
  }
  throw new ApiError_('FORBIDDEN', 'This entity cannot be changed through the public API', 403);
}

function sanitizeEntity_(entityName, record, actor) {
  if (entityName === 'teamMembers') return sanitizeMember_(record);
  const config = getEntityConfig_(entityName);
  const result = {};
  config.fields.forEach(function(field) {
    if (record[field] !== undefined) result[field] = record[field];
  });
  if (entityName === 'estimationSessions') {
    result.canFacilitate = Boolean(findMembership_(actor, record.teamId) && findMembership_(actor, record.teamId).role === 'facilitator');
  }
  return result;
}

function sanitizeVote_(vote, includeEstimate) {
  const result = redactVote_(vote);
  delete result.hasVoted;
  if (includeEstimate) result.estimateHours = vote.estimateHours;
  return result;
}

function sanitizeMember_(member) {
  return {
    id: member.id,
    teamId: member.teamId,
    displayName: member.displayName,
    role: member.role,
    active: member.active
  };
}

function signSessionPayload_(encodedPayload) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(encodedPayload, getOrCreateSessionSecret_())
  ).replace(/=+$/, '');
}

function getOrCreateSessionSecret_() {
  const properties = PropertiesService.getScriptProperties();
  let secret = properties.getProperty(AUTH_SESSION_SECRET_PROPERTY);
  if (secret) return secret;
  return withScriptLock_(function() {
    secret = properties.getProperty(AUTH_SESSION_SECRET_PROPERTY);
    if (!secret) {
      secret = [Utilities.getUuid(), Utilities.getUuid(), Utilities.getUuid(), Utilities.getUuid()].join('');
      properties.setProperty(AUTH_SESSION_SECRET_PROPERTY, secret);
    }
    return secret;
  });
}

function base64UrlEncodeString_(value) {
  return Utilities.base64EncodeWebSafe(Utilities.newBlob(value).getBytes()).replace(/=+$/, '');
}

function base64UrlDecodeString_(value) {
  let paddedValue = String(value);
  while (paddedValue.length % 4) paddedValue += '=';
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(paddedValue)).getDataAsString();
}

function decodeJwtPayload_(token) {
  const normalizedToken = requiredString_(token, 'id_token', 16384);
  const parts = normalizedToken.split('.');
  if (parts.length !== 3) throw new ApiError_('GOOGLE_AUTH_FAILED', 'Google returned an invalid identity token', 401);
  try {
    return JSON.parse(base64UrlDecodeString_(parts[1]));
  } catch (error) {
    throw new ApiError_('GOOGLE_AUTH_FAILED', 'Google returned an invalid identity token', 401);
  }
}

function parseExternalJson_(response, label) {
  try {
    const value = JSON.parse(response.getContentText());
    assertPlainObject_(value, label);
    return value;
  } catch (error) {
    throw new ApiError_('UPSTREAM_INVALID_RESPONSE', label + ' was not valid JSON', 502);
  }
}

function requiredConfiguration_(properties, name) {
  const value = cleanString_(properties.getProperty(name), 10000);
  if (!value) throw new ApiError_('AUTH_NOT_CONFIGURED', 'Missing Apps Script property: ' + name, 500);
  return value;
}

function parsePropertyArray_(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch (error) {
    return [];
  }
}

function sameEmail_(left, right) {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
}

function constantTimeEquals_(left, right) {
  const leftValue = String(left || '');
  const rightValue = String(right || '');
  let difference = leftValue.length ^ rightValue.length;
  const length = Math.max(leftValue.length, rightValue.length);
  for (let index = 0; index < length; index++) {
    difference |= (leftValue.charCodeAt(index) || 0) ^ (rightValue.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function resetGoogleBindingForMember(memberId) {
  const normalizedId = requiredString_(memberId, 'memberId', 200);
  const properties = PropertiesService.getScriptProperties();
  const memberKey = AUTH_MEMBER_PROPERTY_PREFIX + normalizedId;
  const subject = properties.getProperty(memberKey);
  if (!subject) return false;
  properties.deleteProperty(memberKey);
  const subjectKey = AUTH_SUBJECT_PROPERTY_PREFIX + subject;
  const remaining = parsePropertyArray_(properties.getProperty(subjectKey)).filter(function(id) {
    return !sameId_(id, normalizedId);
  });
  if (remaining.length) properties.setProperty(subjectKey, JSON.stringify(remaining));
  else properties.deleteProperty(subjectKey);
  return true;
}

function listEntities_(actor, entityName, filters) {
  const config = getPublicEntityConfig_(entityName);
  let rows = readRows_(config.sheetName);
  assertPlainObject_(filters, 'filters');
  const reserved = ['limit', 'offset'];

  if (entityName === 'teams') {
    rows = rows.filter(function(row) {
      return Boolean(findMembership_(actor, row.id));
    });
  } else if (entityName === 'teamMembers') {
    const teamId = requiredString_(filters.teamId, 'teamId', 200);
    requireTeamMembership_(actor, teamId);
    rows = rows.filter(function(row) { return sameId_(row.teamId, teamId); });
  } else if (entityName === 'estimationSessions') {
    rows = rows.filter(function(row) {
      return Boolean(findMembership_(actor, row.teamId));
    });
  } else {
    throw new ApiError_('FORBIDDEN', 'This entity cannot be listed directly', 403);
  }

  Object.keys(filters || {}).forEach(function(key) {
    if (reserved.indexOf(key) !== -1 || filters[key] === '') return;
    if (config.fields.indexOf(key) === -1) {
      throw new ApiError_('INVALID_FILTER', 'Unknown filter field: ' + key, 400);
    }
    rows = rows.filter(function(row) {
      return String(row[key]) === String(filters[key]);
    });
  });

  const offset = parseInteger_(filters.offset, 'offset', 0, Number.MAX_SAFE_INTEGER, 0);
  const limit = parseInteger_(filters.limit, 'limit', 1, MAX_PAGE_SIZE, 100);

  return {
    ok: true,
    data: rows.slice(offset, offset + limit).map(function(row) {
      return sanitizeEntity_(entityName, row, actor);
    }),
    pagination: {
      offset: offset,
      limit: limit,
      total: rows.length
    }
  };
}

function getEntity_(actor, entityName, id) {
  const config = getPublicEntityConfig_(entityName);
  const normalizedId = requiredString_(id, 'id', 200);
  const record = findById_(config.sheetName, normalizedId);

  if (!record) {
    throw new ApiError_('NOT_FOUND', entityName + ' not found', 404);
  }

  authorizeEntityRead_(actor, entityName, record);

  return { ok: true, data: sanitizeEntity_(entityName, record, actor) };
}

function createEntity_(actor, entityName, data) {
  const config = getPublicEntityConfig_(entityName);
  assertPlainObject_(data, 'data');
  assertAllowedKeys_(data, config.fields, 'data');

  if (entityName === 'estimationSessions') {
    const membership = requireFacilitator_(actor, data.teamId);
    data = copyObject_(data);
    data.createdByMemberId = membership.id;
  } else if (entityName === 'estimationTickets') {
    const targetSession = findById_('EstimationSessions', data.sessionId);
    if (!targetSession) throw new ApiError_('SESSION_NOT_FOUND', 'Session not found', 404);
    requireFacilitator_(actor, targetSession.teamId);
  } else {
    throw new ApiError_('FORBIDDEN', 'This entity cannot be created through the public API', 403);
  }

  const record = {};
  config.fields.forEach(function(field) {
    record[field] = '';
  });
  config.createFields.forEach(function(field) {
    if (data[field] !== undefined) record[field] = data[field];
  });

  record.id = Utilities.getUuid();
  record.createdAt = nowIso_();
  applyDefaults_(entityName, record);
  normalizeAndValidateEntity_(entityName, record, null);
  validateRequired_(config.required, record);
  appendRecord_(config.sheetName, record);

  return { ok: true, data: sanitizeEntity_(entityName, record, actor) };
}

function updateEntity_(actor, entityName, id, patch) {
  const config = getPublicEntityConfig_(entityName);
  const normalizedId = requiredString_(id, 'id', 200);
  assertPlainObject_(patch, 'data');
  assertAllowedKeys_(patch, config.updateFields, 'data');

  if (!Object.keys(patch).length) {
    throw new ApiError_('VALIDATION_ERROR', 'The update contains no fields', 400);
  }

  const current = findById_(config.sheetName, normalizedId);
  if (!current) {
    throw new ApiError_('NOT_FOUND', entityName + ' not found', 404);
  }

  authorizeEntityMutation_(actor, entityName, current);

  const safePatch = copyObject_(patch);
  prepareUpdate_(entityName, current, safePatch);

  const candidate = copyObject_(current);
  Object.keys(safePatch).forEach(function(key) {
    candidate[key] = safePatch[key];
  });
  normalizeAndValidateEntity_(entityName, candidate, current);

  Object.keys(safePatch).forEach(function(key) {
    safePatch[key] = candidate[key];
  });

  const result = updateRecord_(config.sheetName, normalizedId, safePatch);
  return { ok: true, data: sanitizeEntity_(entityName, result, actor) };
}

function deleteEntity_(actor, entityName, id) {
  const config = getPublicEntityConfig_(entityName);
  const normalizedId = requiredString_(id, 'id', 200);
  const current = findById_(config.sheetName, normalizedId);

  if (!current) {
    throw new ApiError_('NOT_FOUND', entityName + ' not found', 404);
  }

  authorizeEntityMutation_(actor, entityName, current);

  assertNoDependencies_(entityName, current);
  const deleted = deleteRecord_(config.sheetName, normalizedId);
  if (entityName === 'estimationTickets') clearRound_(normalizedId);

  return { ok: true, data: sanitizeEntity_(entityName, deleted, actor) };
}

function getSessionState_(actor, sessionId) {
  const normalizedSessionId = requiredString_(sessionId, 'sessionId', 200);
  const session = findById_('EstimationSessions', normalizedSessionId);
  if (!session) {
    throw new ApiError_('SESSION_NOT_FOUND', 'Session not found', 404);
  }
  const viewer = requireTeamMembership_(actor, session.teamId);

  const team = findById_('Teams', session.teamId);
  if (!team) {
    throw new ApiError_('INVALID_DATA', 'The team for this session no longer exists', 409);
  }

  const members = readRows_('TeamMembers').filter(function(row) {
    return sameId_(row.teamId, session.teamId) && toBoolean_(row.active);
  });

  const tickets = readRows_('EstimationTickets')
    .filter(function(row) {
      return sameId_(row.sessionId, normalizedSessionId);
    })
    .sort(function(a, b) {
      return Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
    });

  const currentTicket = tickets.find(function(ticket) {
    return sameId_(ticket.id, session.currentTicketId);
  }) || null;

  let currentRoundNumber = 1;
  let publicVotes = [];
  let statistics = null;

  if (currentTicket) {
    const ticketVotes = readRows_('Votes').filter(function(vote) {
      return sameId_(vote.sessionId, normalizedSessionId) &&
        sameId_(vote.ticketId, currentTicket.id);
    });
    currentRoundNumber = getCurrentRound_(currentTicket.id, ticketVotes);

    const currentVotes = ticketVotes.filter(function(vote) {
      return Number(vote.roundNumber) === currentRoundNumber;
    });
    const valuesMayBeRevealed = ['revealed', 'estimated'].indexOf(currentTicket.status) !== -1;

    publicVotes = currentVotes.map(function(vote) {
      return valuesMayBeRevealed ? sanitizeVote_(vote, true) : redactVote_(vote);
    });

    if (valuesMayBeRevealed) {
      statistics = calculateStatistics_(currentVotes.map(function(vote) {
        return Number(vote.estimateHours);
      }));
    }
  }

  return {
    ok: true,
    data: {
      session: sanitizeEntity_('estimationSessions', session, actor),
      team: sanitizeEntity_('teams', team, actor),
      members: members.map(sanitizeMember_),
      tickets: tickets.map(function(ticket) { return sanitizeEntity_('estimationTickets', ticket, actor); }),
      currentTicket: currentTicket ? sanitizeEntity_('estimationTickets', currentTicket, actor) : null,
      currentRoundNumber: currentRoundNumber,
      votes: publicVotes,
      statistics: statistics,
      viewer: {
        memberId: viewer.id,
        displayName: viewer.displayName,
        role: viewer.role,
        canFacilitate: viewer.role === 'facilitator'
      }
    }
  };
}

function submitVote_(actor, body) {
  assertPlainObject_(body, 'body');
  validateRequired_([
    'sessionId', 'ticketId', 'roundNumber', 'estimateHours'
  ], body);

  const sessionId = requiredString_(body.sessionId, 'sessionId', 200);
  const ticketId = requiredString_(body.ticketId, 'ticketId', 200);
  const roundNumber = parseInteger_(body.roundNumber, 'roundNumber', 1, 1000000);
  const estimateHours = parseVote_(body.estimateHours);

  const session = findById_('EstimationSessions', sessionId);
  if (!session) {
    throw new ApiError_('SESSION_NOT_FOUND', 'Session not found', 404);
  }
  const member = requireTeamMembership_(actor, session.teamId);
  const memberId = member.id;
  if (body.teamMemberId && !sameId_(body.teamMemberId, memberId)) {
    throw new ApiError_('IDENTITY_MISMATCH', 'A vote can only be submitted for the signed-in user', 403);
  }
  if (['completed', 'cancelled'].indexOf(session.status) !== -1) {
    throw new ApiError_('VOTING_CLOSED', 'Voting in this session is closed', 409);
  }
  if (!sameId_(session.currentTicketId, ticketId)) {
    throw new ApiError_('TICKET_NOT_ACTIVE', 'This ticket is not the active ticket', 409);
  }

  const ticket = findById_('EstimationTickets', ticketId);
  if (!ticket || !sameId_(ticket.sessionId, sessionId)) {
    throw new ApiError_('TICKET_NOT_FOUND', 'Ticket not found in session', 404);
  }
  if (['pending', 'voting'].indexOf(ticket.status) === -1) {
    throw new ApiError_('VOTING_CLOSED', 'Voting for this ticket is closed', 409);
  }

  const votes = readRows_('Votes');
  const ticketVotes = votes.filter(function(vote) {
    return sameId_(vote.sessionId, sessionId) && sameId_(vote.ticketId, ticketId);
  });
  const expectedRound = getCurrentRound_(ticketId, ticketVotes);
  if (roundNumber !== expectedRound) {
    throw new ApiError_(
      'ROUND_MISMATCH',
      'The voting round has changed; refresh the session and try again.',
      409
    );
  }

  if (ticket.status === 'pending') {
    updateRecord_('EstimationTickets', ticketId, { status: 'voting' });
    setCurrentRound_(ticketId, expectedRound);
  }

  const existing = ticketVotes.find(function(vote) {
    return sameId_(vote.teamMemberId, memberId) &&
      Number(vote.roundNumber) === expectedRound;
  });

  let vote;
  if (existing) {
    vote = updateRecord_('Votes', existing.id, {
      estimateHours: estimateHours
    });
  } else {
    vote = appendVote_({
      sessionId: sessionId,
      ticketId: ticketId,
      teamMemberId: memberId,
      roundNumber: expectedRound,
      estimateHours: estimateHours
    });
  }

  return {
    ok: true,
    data: {
      voteId: vote.id,
      hasVoted: true,
      roundNumber: expectedRound
    }
  };
}

function revealTicket_(actor, body) {
  assertPlainObject_(body, 'body');
  const ticketId = requiredString_(body.ticketId, 'ticketId', 200);
  const roundNumber = parseInteger_(body.roundNumber, 'roundNumber', 1, 1000000);
  const ticket = findById_('EstimationTickets', ticketId);

  if (!ticket) {
    throw new ApiError_('TICKET_NOT_FOUND', 'Ticket not found', 404);
  }

  const session = findById_('EstimationSessions', ticket.sessionId);
  if (!session || !sameId_(session.currentTicketId, ticketId)) {
    throw new ApiError_('TICKET_NOT_ACTIVE', 'This ticket is not the active ticket', 409);
  }
  requireFacilitator_(actor, session.teamId);
  if (['completed', 'cancelled'].indexOf(session.status) !== -1) {
    throw new ApiError_('SESSION_CLOSED', 'This session is closed', 409);
  }
  if (ticket.status !== 'voting') {
    throw new ApiError_('INVALID_TICKET_STATUS', 'Only an active voting round can be revealed', 409);
  }

  const votes = readRows_('Votes').filter(function(vote) {
    return sameId_(vote.sessionId, session.id) && sameId_(vote.ticketId, ticketId);
  });
  const expectedRound = getCurrentRound_(ticketId, votes);
  if (roundNumber !== expectedRound) {
    throw new ApiError_('ROUND_MISMATCH', 'The voting round has changed; refresh the session.', 409);
  }

  const roundVotes = votes.filter(function(vote) {
    return Number(vote.roundNumber) === expectedRound;
  });
  const updatedTicket = updateRecord_('EstimationTickets', ticketId, {
    status: 'revealed'
  });

  return {
    ok: true,
    data: {
      ticket: sanitizeEntity_('estimationTickets', updatedTicket, actor),
      votes: roundVotes.map(function(vote) { return sanitizeVote_(vote, true); }),
      statistics: calculateStatistics_(roundVotes.map(function(vote) {
        return Number(vote.estimateHours);
      }))
    }
  };
}

function finalizeTicket_(actor, body) {
  assertPlainObject_(body, 'body');
  const ticketId = requiredString_(body.ticketId, 'ticketId', 200);
  const finalEstimateHours = parseDecimal_(
    body.finalEstimateHours,
    'finalEstimateHours',
    0,
    1000
  );
  const ticket = findById_('EstimationTickets', ticketId);

  if (!ticket) {
    throw new ApiError_('TICKET_NOT_FOUND', 'Ticket not found', 404);
  }
  if (ticket.status !== 'revealed') {
    throw new ApiError_(
      'INVALID_TICKET_STATUS',
      'Reveal the votes before saving the final estimate.',
      409
    );
  }

  const session = findById_('EstimationSessions', ticket.sessionId);
  if (!session || !sameId_(session.currentTicketId, ticketId)) {
    throw new ApiError_('TICKET_NOT_ACTIVE', 'This ticket is not the active ticket', 409);
  }
  requireFacilitator_(actor, session.teamId);
  if (['completed', 'cancelled'].indexOf(session.status) !== -1) {
    throw new ApiError_('SESSION_CLOSED', 'This session is closed', 409);
  }

  const updatedTicket = updateRecord_('EstimationTickets', ticketId, {
    status: 'estimated',
    finalEstimateHours: finalEstimateHours
  });

  return { ok: true, data: sanitizeEntity_('estimationTickets', updatedTicket, actor) };
}

function prepareUpdate_(entityName, current, patch) {
  if (entityName === 'estimationSessions') {
    delete patch.startedAt;
    delete patch.completedAt;

    const nextStatus = patch.status === undefined ? current.status : cleanString_(patch.status, 30);
    if (['completed', 'cancelled'].indexOf(current.status) !== -1 && nextStatus !== current.status) {
      throw new ApiError_('SESSION_CLOSED', 'A closed session cannot be reopened', 409);
    }
    if (nextStatus === 'active' && !current.startedAt) patch.startedAt = nowIso_();
    if (nextStatus === 'completed') {
      patch.completedAt = current.completedAt || nowIso_();
      patch.currentTicketId = '';
    }
  }

  if (entityName === 'estimationTickets' && patch.status !== undefined) {
    const nextStatus = cleanString_(patch.status, 30);
    if (['revealed', 'estimated'].indexOf(nextStatus) !== -1) {
      throw new ApiError_(
        'USE_DEDICATED_ACTION',
        'Use revealTicket or finalizeTicket for this status change',
        400
      );
    }

    if (nextStatus === 'voting') {
      const session = findById_('EstimationSessions', current.sessionId);
      if (!session || !sameId_(session.currentTicketId, current.id)) {
        throw new ApiError_('TICKET_NOT_ACTIVE', 'Activate this ticket in the session first', 409);
      }
      if (['completed', 'cancelled'].indexOf(session.status) !== -1) {
        throw new ApiError_('SESSION_CLOSED', 'This session is closed', 409);
      }

      const votes = readRows_('Votes').filter(function(vote) {
        return sameId_(vote.sessionId, current.sessionId) && sameId_(vote.ticketId, current.id);
      });
      let roundNumber = getCurrentRound_(current.id, votes);
      if (['revealed', 'estimated', 'skipped'].indexOf(current.status) !== -1) {
        roundNumber += 1;
      }
      setCurrentRound_(current.id, roundNumber);

      if (current.status === 'estimated') patch.finalEstimateHours = '';
    }
  }
}

function normalizeAndValidateEntity_(entityName, record, current) {
  switch (entityName) {
    case 'teams':
      record.name = requiredString_(record.name, 'name', 200);
      record.jiraBaseUrl = optionalString_(record.jiraBaseUrl, 'jiraBaseUrl', 1000);
      record.jiraProjectKey = optionalString_(record.jiraProjectKey, 'jiraProjectKey', 100).toUpperCase();
      record.active = parseBoolean_(record.active, 'active', true);
      validateHttpUrl_(record.jiraBaseUrl, 'jiraBaseUrl');
      break;

    case 'teamMembers':
      record.teamId = requiredString_(record.teamId, 'teamId', 200);
      record.displayName = requiredString_(record.displayName, 'displayName', 200);
      record.email = optionalString_(record.email, 'email', 320);
      record.role = optionalString_(record.role, 'role', 50) || 'member';
      record.active = parseBoolean_(record.active, 'active', true);
      assertOneOf_(record.role, MEMBER_ROLES, 'role');
      assertRecordExists_('Teams', record.teamId, 'TEAM_NOT_FOUND', 'Team not found');
      break;

    case 'estimationSessions':
      record.teamId = requiredString_(record.teamId, 'teamId', 200);
      record.name = requiredString_(record.name, 'name', 200);
      record.status = optionalString_(record.status, 'status', 30) || 'draft';
      record.createdByMemberId = requiredString_(record.createdByMemberId, 'createdByMemberId', 200);
      record.currentTicketId = optionalString_(record.currentTicketId, 'currentTicketId', 200);
      assertOneOf_(record.status, SESSION_STATUSES, 'status');
      validateSessionRelations_(record, current);
      break;

    case 'estimationTickets':
      record.sessionId = requiredString_(record.sessionId, 'sessionId', 200);
      record.jiraIssueKey = requiredString_(record.jiraIssueKey, 'jiraIssueKey', 100).toUpperCase();
      record.summary = requiredString_(record.summary, 'summary', 500);
      record.description = optionalString_(record.description, 'description', 10000);
      record.status = optionalString_(record.status, 'status', 30) || 'pending';
      record.sortOrder = parseInteger_(record.sortOrder, 'sortOrder', 1, 1000000);
      assertOneOf_(record.status, TICKET_STATUSES, 'status');
      validateTicketRelations_(record, current);
      break;

    default:
      throw new ApiError_('UNKNOWN_ENTITY', 'Unknown entity: ' + entityName, 400);
  }
}

function validateSessionRelations_(session, current) {
  const team = findById_('Teams', session.teamId);
  if (!team) {
    throw new ApiError_('TEAM_NOT_FOUND', 'Team not found', 404);
  }

  const creator = findById_('TeamMembers', session.createdByMemberId);
  if (!creator || !sameId_(creator.teamId, session.teamId) || (!current && !toBoolean_(creator.active))) {
    throw new ApiError_(
      'INVALID_FACILITATOR',
      'The selected facilitator is not an active member of this team',
      400
    );
  }

  if (session.currentTicketId) {
    const ticket = findById_('EstimationTickets', session.currentTicketId);
    if (!ticket || !sameId_(ticket.sessionId, session.id)) {
      throw new ApiError_(
        'INVALID_CURRENT_TICKET',
        'The active ticket does not belong to this session',
        400
      );
    }
  }
}

function validateTicketRelations_(ticket, current) {
  const session = findById_('EstimationSessions', ticket.sessionId);
  if (!session) {
    throw new ApiError_('SESSION_NOT_FOUND', 'Session not found', 404);
  }
  if (['completed', 'cancelled'].indexOf(session.status) !== -1) {
    throw new ApiError_('SESSION_CLOSED', 'Tickets in a closed session cannot be changed', 409);
  }

  const duplicate = readRows_('EstimationTickets').find(function(other) {
    return sameId_(other.sessionId, ticket.sessionId) &&
      !sameId_(other.id, ticket.id) &&
      String(other.jiraIssueKey || '').trim().toUpperCase() === ticket.jiraIssueKey;
  });
  if (duplicate) {
    throw new ApiError_('DUPLICATE_TICKET', 'This Jira key is already in the session', 409);
  }
}

function assertNoDependencies_(entityName, record) {
  let hasDependencies = false;

  switch (entityName) {
    case 'teams':
      hasDependencies = readRows_('TeamMembers').some(function(member) {
        return sameId_(member.teamId, record.id);
      }) || readRows_('EstimationSessions').some(function(session) {
        return sameId_(session.teamId, record.id);
      });
      break;
    case 'teamMembers':
      hasDependencies = readRows_('EstimationSessions').some(function(session) {
        return sameId_(session.createdByMemberId, record.id);
      }) || readRows_('Votes').some(function(vote) {
        return sameId_(vote.teamMemberId, record.id);
      });
      break;
    case 'estimationSessions':
      hasDependencies = readRows_('EstimationTickets').some(function(ticket) {
        return sameId_(ticket.sessionId, record.id);
      }) || readRows_('Votes').some(function(vote) {
        return sameId_(vote.sessionId, record.id);
      });
      break;
    case 'estimationTickets':
      hasDependencies = readRows_('Votes').some(function(vote) {
        return sameId_(vote.ticketId, record.id);
      });
      break;
  }

  if (hasDependencies) {
    throw new ApiError_(
      'ENTITY_IN_USE',
      'This record cannot be deleted because related data exists',
      409
    );
  }
}

function applyDefaults_(entityName, record) {
  switch (entityName) {
    case 'teams':
      if (record.active === '') record.active = true;
      break;
    case 'teamMembers':
      if (!record.role) record.role = 'member';
      if (record.active === '') record.active = true;
      break;
    case 'estimationSessions':
      record.status = 'draft';
      record.startedAt = '';
      record.completedAt = '';
      record.currentTicketId = '';
      break;
    case 'estimationTickets':
      record.status = 'pending';
      record.finalEstimateHours = '';
      if (record.sortOrder === '') record.sortOrder = nextTicketSortOrder_(record.sessionId);
      break;
  }
}

function nextTicketSortOrder_(sessionId) {
  const tickets = readRows_('EstimationTickets').filter(function(row) {
    return sameId_(row.sessionId, sessionId);
  });

  if (!tickets.length) return 1;

  return Math.max.apply(null, tickets.map(function(row) {
    const value = Number(row.sortOrder);
    return Number.isFinite(value) ? value : 0;
  })) + 1;
}

function appendVote_(data) {
  const record = {
    id: Utilities.getUuid(),
    sessionId: data.sessionId,
    ticketId: data.ticketId,
    teamMemberId: data.teamMemberId,
    roundNumber: data.roundNumber,
    estimateHours: data.estimateHours,
    createdAt: nowIso_()
  };
  appendRecord_('Votes', record);
  return record;
}

function redactVote_(vote) {
  return {
    id: vote.id,
    sessionId: vote.sessionId,
    ticketId: vote.ticketId,
    teamMemberId: vote.teamMemberId,
    roundNumber: vote.roundNumber,
    hasVoted: true,
    createdAt: vote.createdAt
  };
}

function calculateStatistics_(values) {
  const validValues = values.filter(function(value) {
    return Number.isFinite(value);
  });
  if (!validValues.length) {
    return { count: 0, min: null, max: null, average: null, median: null };
  }

  const sorted = validValues.slice().sort(function(a, b) { return a - b; });
  const sum = sorted.reduce(function(total, value) { return total + value; }, 0);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;

  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    average: Math.round((sum / sorted.length) * 100) / 100,
    median: median
  };
}

function getCurrentRound_(ticketId, votes) {
  const storedValue = PropertiesService.getScriptProperties().getProperty(
    ROUND_PROPERTY_PREFIX + String(ticketId)
  );
  const storedRound = Number(storedValue);
  const highestVoteRound = (votes || []).reduce(function(highest, vote) {
    const value = Number(vote.roundNumber);
    return Number.isInteger(value) && value > highest ? value : highest;
  }, 0);

  return Math.max(
    1,
    Number.isInteger(storedRound) ? storedRound : 0,
    highestVoteRound
  );
}

function setCurrentRound_(ticketId, roundNumber) {
  PropertiesService.getScriptProperties().setProperty(
    ROUND_PROPERTY_PREFIX + String(ticketId),
    String(roundNumber)
  );
}

function clearRound_(ticketId) {
  PropertiesService.getScriptProperties().deleteProperty(
    ROUND_PROPERTY_PREFIX + String(ticketId)
  );
}

function readRows_(sheetName) {
  const data = getSheetData_(sheetName);
  if (data.values.length < 2) return [];

  return data.values.slice(1)
    .filter(function(row) {
      return row.some(function(value) { return value !== ''; });
    })
    .map(function(row) {
      return rowToRecord_(data.headers, row);
    });
}

function findById_(sheetName, id) {
  return readRows_(sheetName).find(function(row) {
    return sameId_(row.id, id);
  }) || null;
}

function appendRecord_(sheetName, record) {
  const data = getSheetData_(sheetName);
  const row = data.headers.map(function(header) {
    return record[header] === undefined ? '' : record[header];
  });
  data.sheet.getRange(data.sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

function updateRecord_(sheetName, id, patch) {
  const data = getSheetData_(sheetName);
  const idIndex = data.headers.indexOf('id');

  for (let rowIndex = 1; rowIndex < data.values.length; rowIndex++) {
    if (!sameId_(data.values[rowIndex][idIndex], id)) continue;

    const updatedRow = data.values[rowIndex].slice();
    Object.keys(patch).forEach(function(key) {
      const columnIndex = data.headers.indexOf(key);
      if (columnIndex !== -1 && key !== 'id' && key !== 'createdAt') {
        updatedRow[columnIndex] = patch[key];
      }
    });

    Object.keys(patch).forEach(function(key) {
      const columnIndex = data.headers.indexOf(key);
      if (columnIndex !== -1 && key !== 'id' && key !== 'createdAt') {
        data.sheet.getRange(rowIndex + 1, columnIndex + 1).setValue(patch[key]);
      }
    });
    return rowToRecord_(data.headers, updatedRow);
  }

  return null;
}

function deleteRecord_(sheetName, id) {
  const data = getSheetData_(sheetName);
  const idIndex = data.headers.indexOf('id');

  for (let rowIndex = 1; rowIndex < data.values.length; rowIndex++) {
    if (sameId_(data.values[rowIndex][idIndex], id)) {
      const deleted = rowToRecord_(data.headers, data.values[rowIndex]);
      data.sheet.deleteRow(rowIndex + 1);
      return deleted;
    }
  }

  return null;
}

function getSheetData_(sheetName) {
  const sheet = getSheet_(sheetName);
  const config = getEntityConfigBySheetName_(sheetName);
  const lastColumn = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();

  if (lastColumn < 1 || lastRow < 1) {
    throw new ApiError_('INVALID_SHEET', 'Sheet has no header row: ' + sheetName, 500);
  }

  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = values[0].map(function(header) {
    return String(header).trim();
  });
  validateHeaders_(sheetName, headers, config.fields);

  return { sheet: sheet, headers: headers, values: values };
}

function validateHeaders_(sheetName, headers, requiredHeaders) {
  const seen = {};
  headers.forEach(function(header) {
    if (!header) {
      throw new ApiError_('INVALID_SHEET', 'Empty column name in ' + sheetName, 500);
    }
    if (seen[header]) {
      throw new ApiError_('INVALID_SHEET', 'Duplicate column name in ' + sheetName + ': ' + header, 500);
    }
    seen[header] = true;
  });

  requiredHeaders.forEach(function(header) {
    if (!seen[header]) {
      throw new ApiError_('INVALID_SHEET', 'Missing column in ' + sheetName + ': ' + header, 500);
    }
  });
}

function rowToRecord_(headers, row) {
  const record = {};
  headers.forEach(function(header, index) {
    record[header] = normalizeValue_(row[index]);
  });
  return record;
}

function getSheet_(sheetName) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new ApiError_('SPREADSHEET_NOT_FOUND', 'No active spreadsheet found', 500);
  }
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    throw new ApiError_('SHEET_NOT_FOUND', 'Missing sheet: ' + sheetName, 500);
  }
  return sheet;
}

function getPublicEntityConfig_(entityName) {
  const normalizedName = cleanString_(entityName, 100);
  if (normalizedName === 'votes') {
    throw new ApiError_(
      'PROTECTED_ENTITY',
      'Votes are only available through the voting and session actions',
      403
    );
  }
  return getEntityConfig_(normalizedName);
}

function getEntityConfig_(entityName) {
  if (!Object.prototype.hasOwnProperty.call(SHEETS, entityName)) {
    throw new ApiError_('UNKNOWN_ENTITY', 'Unknown entity: ' + entityName, 400);
  }
  return SHEETS[entityName];
}

function getEntityConfigBySheetName_(sheetName) {
  const entityName = Object.keys(SHEETS).find(function(name) {
    return SHEETS[name].sheetName === sheetName;
  });
  if (!entityName) {
    throw new ApiError_('UNKNOWN_SHEET', 'Unknown sheet: ' + sheetName, 500);
  }
  return SHEETS[entityName];
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};

  try {
    const body = JSON.parse(e.postData.contents);
    assertPlainObject_(body, 'body');
    return body;
  } catch (error) {
    if (error && error.name === 'ApiError') throw error;
    throw new ApiError_('INVALID_JSON', 'Invalid JSON body', 400);
  }
}

function withScriptLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    throw new ApiError_('API_BUSY', 'The API is busy; try again shortly.', 503);
  }

  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function validateRequired_(fields, data) {
  fields.forEach(function(field) {
    assertValue_(data[field], field);
  });
}

function assertValue_(value, name) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new ApiError_('VALIDATION_ERROR', name + ' is required', 400);
  }
}

function assertPlainObject_(value, name) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') {
    throw new ApiError_('VALIDATION_ERROR', name + ' must be an object', 400);
  }
}

function assertAllowedKeys_(value, allowedKeys, name) {
  Object.keys(value).forEach(function(key) {
    if (allowedKeys.indexOf(key) === -1) {
      throw new ApiError_('VALIDATION_ERROR', name + ' contains an unknown field: ' + key, 400);
    }
  });
}

function requiredString_(value, name, maxLength) {
  assertValue_(value, name);
  return cleanStringWithLimit_(value, name, maxLength);
}

function optionalString_(value, name, maxLength) {
  if (value === undefined || value === null || value === '') return '';
  return cleanStringWithLimit_(value, name, maxLength);
}

function cleanString_(value, maxLength) {
  if (value === undefined || value === null) return '';
  const result = String(value).trim();
  return result.length > maxLength ? result.slice(0, maxLength) : result;
}

function cleanStringWithLimit_(value, name, maxLength) {
  const result = String(value).trim();
  if (result.length > maxLength) {
    throw new ApiError_(
      'VALIDATION_ERROR',
      name + ' may contain no more than ' + maxLength + ' characters',
      400
    );
  }
  return result;
}

function parseBoolean_(value, name, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (value === true || value === false) return value;
  if (String(value).toLowerCase() === 'true') return true;
  if (String(value).toLowerCase() === 'false') return false;
  throw new ApiError_('VALIDATION_ERROR', name + ' must be true or false', 400);
}

function parseInteger_(value, name, min, max, defaultValue) {
  if ((value === undefined || value === null || value === '') && defaultValue !== undefined) {
    return defaultValue;
  }
  const normalized = typeof value === 'string' ? value.trim() : value;
  const number = Number(normalized);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new ApiError_(
      'VALIDATION_ERROR',
      name + ' must be an integer from ' + min + ' to ' + max,
      400
    );
  }
  return number;
}

function parseDecimal_(value, name, min, max) {
  assertValue_(value, name);
  const normalized = typeof value === 'string' ? value.trim().replace(',', '.') : value;
  if (typeof normalized !== 'number' && !/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new ApiError_(
      'VALIDATION_ERROR',
      name + ' must be a number with no more than two decimal places',
      400
    );
  }
  const number = Number(normalized);
  const rounded = Math.round(number * 100) / 100;
  if (!Number.isFinite(number) || rounded !== number || number < min || number > max) {
    throw new ApiError_(
      'VALIDATION_ERROR',
      name + ' must be a number from ' + min + ' to ' + max,
      400
    );
  }
  return number;
}

function parseVote_(value) {
  const estimate = parseDecimal_(value, 'estimateHours', 0, 1000);
  if (VOTE_VALUES.indexOf(estimate) === -1) {
    throw new ApiError_(
      'INVALID_ESTIMATE',
      'Select an allowed estimate value',
      400
    );
  }
  return estimate;
}

function assertOneOf_(value, allowedValues, name) {
  if (allowedValues.indexOf(value) === -1) {
    throw new ApiError_(
      'VALIDATION_ERROR',
      name + ' has an invalid value',
      400
    );
  }
}

function assertRecordExists_(sheetName, id, code, message) {
  if (!findById_(sheetName, id)) {
    throw new ApiError_(code, message, 404);
  }
}

function validateHttpUrl_(value, name) {
  if (!value) return;
  if (!/^https?:\/\/[^\s]+$/i.test(value)) {
    throw new ApiError_('VALIDATION_ERROR', name + ' must be a valid HTTP(S) URL', 400);
  }
}

function requirePost_(method) {
  if (method !== 'POST') {
    throw new ApiError_('METHOD_NOT_ALLOWED', 'Use POST for this action', 405);
  }
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function normalizeValue_(value) {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function toBoolean_(value) {
  return value === true || String(value).toLowerCase() === 'true';
}

function sameId_(left, right) {
  return String(left) === String(right);
}

function copyObject_(value) {
  const copy = {};
  Object.keys(value).forEach(function(key) {
    copy[key] = value[key];
  });
  return copy;
}

function nowIso_() {
  return new Date().toISOString();
}

function ApiError_(code, message, status) {
  this.name = 'ApiError';
  this.code = code;
  this.message = message;
  this.status = status;
  if (Error.captureStackTrace) Error.captureStackTrace(this, ApiError_);
}
ApiError_.prototype = Object.create(Error.prototype);
ApiError_.prototype.constructor = ApiError_;
