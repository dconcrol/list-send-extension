/* List Send API client — messages the background SW (own store, no live verify). */

(function (global) {
  function call(action, payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'CVLIST_API', action, payload }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response || response.ok === false) {
          const err = new Error((response && response.error) || 'Request failed.');
          err.status = response && response.status;
          reject(err);
          return;
        }
        resolve(response);
      });
    });
  }

  async function getState() {
    return call('getState');
  }

  async function importAccounts(accounts) {
    return call('importAccounts', { accounts });
  }

  async function clearAccounts() {
    return call('clearAccounts');
  }

  async function saveTemplate({ id, kind, content }) {
    return call('saveTemplate', { id, kind, content });
  }

  async function deleteTemplate(id) {
    return call('deleteTemplate', { id });
  }

  async function buildSchedule(count) {
    return call('buildSchedule', { count });
  }

  async function prepareDirectSend(count, accountIds) {
    return call('prepareDirectSend', { count, accountIds });
  }

  async function markAccountSent(accountId) {
    return call('markAccountSent', { accountId });
  }

  async function removeScheduleItem(id) {
    return call('removeScheduleItem', { id });
  }

  async function completeScheduleItem(id, { immediate } = {}) {
    return call('completeScheduleItem', { id, immediate: Boolean(immediate) });
  }

  async function failScheduleItem(id, error) {
    return call('failScheduleItem', { id, error });
  }

  global.CVListApi = {
    getState,
    importAccounts,
    clearAccounts,
    saveTemplate,
    deleteTemplate,
    buildSchedule,
    prepareDirectSend,
    markAccountSent,
    removeScheduleItem,
    completeScheduleItem,
    failScheduleItem
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
