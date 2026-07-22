const API_VERSION = 'v1';
const LOCK_TIMEOUT_MS = 10000;
const MAX_PAGE_SIZE = 500;
const ROUND_PROPERTY_PREFIX = 'estimationPoker.round.';
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
            'GET  ?action=list&entity=teams',
            'GET  ?action=get&entity=teams&id=...',
            'POST action=create',
            'POST action=update',
            'POST action=delete',
            'GET  ?action=sessionState&sessionId=...',
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

      case 'list':
        return jsonResponse_(listEntities_(
          params.entity || body.entity,
          params
        ));

      case 'get':
        return jsonResponse_(getEntity_(
          params.entity || body.entity,
          params.id || body.id
        ));

      case 'create':
        requirePost_(method);
        return jsonResponse_(withScriptLock_(function() {
          return createEntity_(body.entity, body.data || {});
        }));

      case 'update':
        requirePost_(method);
        return jsonResponse_(withScriptLock_(function() {
          return updateEntity_(body.entity, body.id, body.data || {});
        }));

      case 'delete':
        requirePost_(method);
        return jsonResponse_(withScriptLock_(function() {
          return deleteEntity_(body.entity, body.id);
        }));

      case 'sessionState':
        return jsonResponse_(getSessionState_(
          params.sessionId || body.sessionId
        ));

      case 'submitVote':
        requirePost_(method);
        return jsonResponse_(withScriptLock_(function() {
          return submitVote_(body);
        }));

      case 'revealTicket':
        requirePost_(method);
        return jsonResponse_(withScriptLock_(function() {
          return revealTicket_(body);
        }));

      case 'finalizeTicket':
        requirePost_(method);
        return jsonResponse_(withScriptLock_(function() {
          return finalizeTicket_(body);
        }));

      default:
        throw new ApiError_('UNKNOWN_ACTION', 'Onbekende action: ' + action, 400);
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
        message: isApiError ? error.message : 'Er is een interne serverfout opgetreden.',
        status: isApiError ? error.status : 500
      }
    });
  }
}

function listEntities_(entityName, filters) {
  const config = getPublicEntityConfig_(entityName);
  let rows = readRows_(config.sheetName);
  const reserved = ['action', 'entity', 'limit', 'offset'];

  Object.keys(filters || {}).forEach(function(key) {
    if (reserved.indexOf(key) !== -1 || filters[key] === '') return;
    if (config.fields.indexOf(key) === -1) {
      throw new ApiError_('INVALID_FILTER', 'Onbekend filterveld: ' + key, 400);
    }
    rows = rows.filter(function(row) {
      return String(row[key]) === String(filters[key]);
    });
  });

  const offset = parseInteger_(filters.offset, 'offset', 0, Number.MAX_SAFE_INTEGER, 0);
  const limit = parseInteger_(filters.limit, 'limit', 1, MAX_PAGE_SIZE, 100);

  return {
    ok: true,
    data: rows.slice(offset, offset + limit),
    pagination: {
      offset: offset,
      limit: limit,
      total: rows.length
    }
  };
}

function getEntity_(entityName, id) {
  const config = getPublicEntityConfig_(entityName);
  const normalizedId = requiredString_(id, 'id', 200);
  const record = findById_(config.sheetName, normalizedId);

  if (!record) {
    throw new ApiError_('NOT_FOUND', entityName + ' niet gevonden', 404);
  }

  return { ok: true, data: record };
}

function createEntity_(entityName, data) {
  const config = getPublicEntityConfig_(entityName);
  assertPlainObject_(data, 'data');
  assertAllowedKeys_(data, config.fields, 'data');

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

  return { ok: true, data: record };
}

function updateEntity_(entityName, id, patch) {
  const config = getPublicEntityConfig_(entityName);
  const normalizedId = requiredString_(id, 'id', 200);
  assertPlainObject_(patch, 'data');
  assertAllowedKeys_(patch, config.updateFields, 'data');

  if (!Object.keys(patch).length) {
    throw new ApiError_('VALIDATION_ERROR', 'De update bevat geen velden', 400);
  }

  const current = findById_(config.sheetName, normalizedId);
  if (!current) {
    throw new ApiError_('NOT_FOUND', entityName + ' niet gevonden', 404);
  }

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
  return { ok: true, data: result };
}

function deleteEntity_(entityName, id) {
  const config = getPublicEntityConfig_(entityName);
  const normalizedId = requiredString_(id, 'id', 200);
  const current = findById_(config.sheetName, normalizedId);

  if (!current) {
    throw new ApiError_('NOT_FOUND', entityName + ' niet gevonden', 404);
  }

  assertNoDependencies_(entityName, current);
  const deleted = deleteRecord_(config.sheetName, normalizedId);
  if (entityName === 'estimationTickets') clearRound_(normalizedId);

  return { ok: true, data: deleted };
}

function getSessionState_(sessionId) {
  const normalizedSessionId = requiredString_(sessionId, 'sessionId', 200);
  const session = findById_('EstimationSessions', normalizedSessionId);
  if (!session) {
    throw new ApiError_('SESSION_NOT_FOUND', 'Sessie niet gevonden', 404);
  }

  const team = findById_('Teams', session.teamId);
  if (!team) {
    throw new ApiError_('INVALID_DATA', 'Het team van deze sessie bestaat niet meer', 409);
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
      return valuesMayBeRevealed ? vote : redactVote_(vote);
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
      session: session,
      team: team,
      members: members,
      tickets: tickets,
      currentTicket: currentTicket,
      currentRoundNumber: currentRoundNumber,
      votes: publicVotes,
      statistics: statistics
    }
  };
}

function submitVote_(body) {
  assertPlainObject_(body, 'body');
  validateRequired_([
    'sessionId', 'ticketId', 'teamMemberId',
    'roundNumber', 'estimateHours'
  ], body);

  const sessionId = requiredString_(body.sessionId, 'sessionId', 200);
  const ticketId = requiredString_(body.ticketId, 'ticketId', 200);
  const memberId = requiredString_(body.teamMemberId, 'teamMemberId', 200);
  const roundNumber = parseInteger_(body.roundNumber, 'roundNumber', 1, 1000000);
  const estimateHours = parseVote_(body.estimateHours);

  const session = findById_('EstimationSessions', sessionId);
  if (!session) {
    throw new ApiError_('SESSION_NOT_FOUND', 'Sessie niet gevonden', 404);
  }
  if (['completed', 'cancelled'].indexOf(session.status) !== -1) {
    throw new ApiError_('VOTING_CLOSED', 'Stemmen in deze sessie is gesloten', 409);
  }
  if (!sameId_(session.currentTicketId, ticketId)) {
    throw new ApiError_('TICKET_NOT_ACTIVE', 'Dit ticket is niet het actieve ticket', 409);
  }

  const ticket = findById_('EstimationTickets', ticketId);
  if (!ticket || !sameId_(ticket.sessionId, sessionId)) {
    throw new ApiError_('TICKET_NOT_FOUND', 'Ticket niet gevonden in sessie', 404);
  }
  if (['pending', 'voting'].indexOf(ticket.status) === -1) {
    throw new ApiError_('VOTING_CLOSED', 'Stemmen voor dit ticket is gesloten', 409);
  }

  const member = findById_('TeamMembers', memberId);
  if (!member || !sameId_(member.teamId, session.teamId) || !toBoolean_(member.active)) {
    throw new ApiError_('MEMBER_NOT_ELIGIBLE', 'Dit teamlid mag niet stemmen in deze sessie', 403);
  }

  const votes = readRows_('Votes');
  const ticketVotes = votes.filter(function(vote) {
    return sameId_(vote.sessionId, sessionId) && sameId_(vote.ticketId, ticketId);
  });
  const expectedRound = getCurrentRound_(ticketId, ticketVotes);
  if (roundNumber !== expectedRound) {
    throw new ApiError_(
      'ROUND_MISMATCH',
      'De stemronde is gewijzigd; ververs de sessie en probeer opnieuw.',
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

function revealTicket_(body) {
  assertPlainObject_(body, 'body');
  const ticketId = requiredString_(body.ticketId, 'ticketId', 200);
  const roundNumber = parseInteger_(body.roundNumber, 'roundNumber', 1, 1000000);
  const ticket = findById_('EstimationTickets', ticketId);

  if (!ticket) {
    throw new ApiError_('TICKET_NOT_FOUND', 'Ticket niet gevonden', 404);
  }

  const session = findById_('EstimationSessions', ticket.sessionId);
  if (!session || !sameId_(session.currentTicketId, ticketId)) {
    throw new ApiError_('TICKET_NOT_ACTIVE', 'Dit ticket is niet het actieve ticket', 409);
  }
  if (['completed', 'cancelled'].indexOf(session.status) !== -1) {
    throw new ApiError_('SESSION_CLOSED', 'Deze sessie is gesloten', 409);
  }
  if (ticket.status !== 'voting') {
    throw new ApiError_('INVALID_TICKET_STATUS', 'Alleen een actieve stemronde kan worden onthuld', 409);
  }

  const votes = readRows_('Votes').filter(function(vote) {
    return sameId_(vote.sessionId, session.id) && sameId_(vote.ticketId, ticketId);
  });
  const expectedRound = getCurrentRound_(ticketId, votes);
  if (roundNumber !== expectedRound) {
    throw new ApiError_('ROUND_MISMATCH', 'De stemronde is gewijzigd; ververs de sessie.', 409);
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
      ticket: updatedTicket,
      votes: roundVotes,
      statistics: calculateStatistics_(roundVotes.map(function(vote) {
        return Number(vote.estimateHours);
      }))
    }
  };
}

function finalizeTicket_(body) {
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
    throw new ApiError_('TICKET_NOT_FOUND', 'Ticket niet gevonden', 404);
  }
  if (ticket.status !== 'revealed') {
    throw new ApiError_(
      'INVALID_TICKET_STATUS',
      'Onthul de stemmen voordat de definitieve schatting wordt opgeslagen.',
      409
    );
  }

  const session = findById_('EstimationSessions', ticket.sessionId);
  if (!session || !sameId_(session.currentTicketId, ticketId)) {
    throw new ApiError_('TICKET_NOT_ACTIVE', 'Dit ticket is niet het actieve ticket', 409);
  }
  if (['completed', 'cancelled'].indexOf(session.status) !== -1) {
    throw new ApiError_('SESSION_CLOSED', 'Deze sessie is gesloten', 409);
  }

  const updatedTicket = updateRecord_('EstimationTickets', ticketId, {
    status: 'estimated',
    finalEstimateHours: finalEstimateHours
  });

  return { ok: true, data: updatedTicket };
}

function prepareUpdate_(entityName, current, patch) {
  if (entityName === 'estimationSessions') {
    delete patch.startedAt;
    delete patch.completedAt;

    const nextStatus = patch.status === undefined ? current.status : cleanString_(patch.status, 30);
    if (['completed', 'cancelled'].indexOf(current.status) !== -1 && nextStatus !== current.status) {
      throw new ApiError_('SESSION_CLOSED', 'Een gesloten sessie kan niet opnieuw worden geopend', 409);
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
        'Gebruik revealTicket of finalizeTicket voor deze statuswijziging',
        400
      );
    }

    if (nextStatus === 'voting') {
      const session = findById_('EstimationSessions', current.sessionId);
      if (!session || !sameId_(session.currentTicketId, current.id)) {
        throw new ApiError_('TICKET_NOT_ACTIVE', 'Activeer dit ticket eerst in de sessie', 409);
      }
      if (['completed', 'cancelled'].indexOf(session.status) !== -1) {
        throw new ApiError_('SESSION_CLOSED', 'Deze sessie is gesloten', 409);
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
      assertRecordExists_('Teams', record.teamId, 'TEAM_NOT_FOUND', 'Team niet gevonden');
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
      throw new ApiError_('UNKNOWN_ENTITY', 'Onbekende entity: ' + entityName, 400);
  }
}

function validateSessionRelations_(session, current) {
  const team = findById_('Teams', session.teamId);
  if (!team) {
    throw new ApiError_('TEAM_NOT_FOUND', 'Team niet gevonden', 404);
  }

  const creator = findById_('TeamMembers', session.createdByMemberId);
  if (!creator || !sameId_(creator.teamId, session.teamId) || (!current && !toBoolean_(creator.active))) {
    throw new ApiError_(
      'INVALID_FACILITATOR',
      'De gekozen facilitator is geen actief lid van dit team',
      400
    );
  }

  if (session.currentTicketId) {
    const ticket = findById_('EstimationTickets', session.currentTicketId);
    if (!ticket || !sameId_(ticket.sessionId, session.id)) {
      throw new ApiError_(
        'INVALID_CURRENT_TICKET',
        'Het actieve ticket hoort niet bij deze sessie',
        400
      );
    }
  }
}

function validateTicketRelations_(ticket, current) {
  const session = findById_('EstimationSessions', ticket.sessionId);
  if (!session) {
    throw new ApiError_('SESSION_NOT_FOUND', 'Sessie niet gevonden', 404);
  }
  if (['completed', 'cancelled'].indexOf(session.status) !== -1) {
    throw new ApiError_('SESSION_CLOSED', 'Tickets in een gesloten sessie kunnen niet worden gewijzigd', 409);
  }

  const duplicate = readRows_('EstimationTickets').find(function(other) {
    return sameId_(other.sessionId, ticket.sessionId) &&
      !sameId_(other.id, ticket.id) &&
      String(other.jiraIssueKey || '').trim().toUpperCase() === ticket.jiraIssueKey;
  });
  if (duplicate) {
    throw new ApiError_('DUPLICATE_TICKET', 'Deze Jira-key staat al in de sessie', 409);
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
      'Dit record kan niet worden verwijderd omdat er gekoppelde gegevens bestaan',
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
    throw new ApiError_('INVALID_SHEET', 'Tabblad heeft geen kopregel: ' + sheetName, 500);
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
      throw new ApiError_('INVALID_SHEET', 'Lege kolomnaam in ' + sheetName, 500);
    }
    if (seen[header]) {
      throw new ApiError_('INVALID_SHEET', 'Dubbele kolomnaam in ' + sheetName + ': ' + header, 500);
    }
    seen[header] = true;
  });

  requiredHeaders.forEach(function(header) {
    if (!seen[header]) {
      throw new ApiError_('INVALID_SHEET', 'Kolom ontbreekt in ' + sheetName + ': ' + header, 500);
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
    throw new ApiError_('SPREADSHEET_NOT_FOUND', 'Geen actieve spreadsheet gevonden', 500);
  }
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    throw new ApiError_('SHEET_NOT_FOUND', 'Tabblad ontbreekt: ' + sheetName, 500);
  }
  return sheet;
}

function getPublicEntityConfig_(entityName) {
  const normalizedName = cleanString_(entityName, 100);
  if (normalizedName === 'votes') {
    throw new ApiError_(
      'PROTECTED_ENTITY',
      'Stemmen zijn alleen beschikbaar via de stem- en sessieacties',
      403
    );
  }
  return getEntityConfig_(normalizedName);
}

function getEntityConfig_(entityName) {
  if (!Object.prototype.hasOwnProperty.call(SHEETS, entityName)) {
    throw new ApiError_('UNKNOWN_ENTITY', 'Onbekende entity: ' + entityName, 400);
  }
  return SHEETS[entityName];
}

function getEntityConfigBySheetName_(sheetName) {
  const entityName = Object.keys(SHEETS).find(function(name) {
    return SHEETS[name].sheetName === sheetName;
  });
  if (!entityName) {
    throw new ApiError_('UNKNOWN_SHEET', 'Onbekend tabblad: ' + sheetName, 500);
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
    throw new ApiError_('INVALID_JSON', 'Ongeldige JSON-body', 400);
  }
}

function withScriptLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    throw new ApiError_('API_BUSY', 'De API is bezig; probeer het zo opnieuw.', 503);
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
    throw new ApiError_('VALIDATION_ERROR', name + ' is verplicht', 400);
  }
}

function assertPlainObject_(value, name) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') {
    throw new ApiError_('VALIDATION_ERROR', name + ' moet een object zijn', 400);
  }
}

function assertAllowedKeys_(value, allowedKeys, name) {
  Object.keys(value).forEach(function(key) {
    if (allowedKeys.indexOf(key) === -1) {
      throw new ApiError_('VALIDATION_ERROR', name + ' bevat een onbekend veld: ' + key, 400);
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
      name + ' mag maximaal ' + maxLength + ' tekens bevatten',
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
  throw new ApiError_('VALIDATION_ERROR', name + ' moet true of false zijn', 400);
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
      name + ' moet een geheel getal van ' + min + ' t/m ' + max + ' zijn',
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
      name + ' moet een getal met maximaal twee decimalen zijn',
      400
    );
  }
  const number = Number(normalized);
  const rounded = Math.round(number * 100) / 100;
  if (!Number.isFinite(number) || rounded !== number || number < min || number > max) {
    throw new ApiError_(
      'VALIDATION_ERROR',
      name + ' moet een getal van ' + min + ' t/m ' + max + ' zijn',
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
      'Kies een toegestane schattingswaarde',
      400
    );
  }
  return estimate;
}

function assertOneOf_(value, allowedValues, name) {
  if (allowedValues.indexOf(value) === -1) {
    throw new ApiError_(
      'VALIDATION_ERROR',
      name + ' heeft een ongeldige waarde',
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
    throw new ApiError_('VALIDATION_ERROR', name + ' moet een geldige http(s)-URL zijn', 400);
  }
}

function requirePost_(method) {
  if (method !== 'POST') {
    throw new ApiError_('METHOD_NOT_ALLOWED', 'Gebruik POST voor deze action', 405);
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
