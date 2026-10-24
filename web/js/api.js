// 与本地服务（server.py）通信

async function request(method, url, body, { keepalive = false } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      keepalive,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    const err = new Error('连接不到本地服务');
    err.offline = true;
    throw err;
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* 非 JSON 响应 */
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `请求失败（${res.status}）`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const enc = encodeURIComponent;

export const api = {
  positions: () => request('GET', '/api/positions'),
  position: (pid) => request('GET', `/api/positions/${enc(pid)}`),
  records: (pid) => request('GET', `/api/records/${enc(pid)}`),
  saveRecords: (pid, records) => request('POST', `/api/records/${enc(pid)}`, records),
  archiveRecords: (pid) => request('POST', `/api/records/${enc(pid)}/archive`),
  note: (pid, pageId) => request('GET', `/api/notes/${enc(pid)}/${enc(pageId)}`),
  saveNote: (pid, pageId, body, opts) => request('PUT', `/api/notes/${enc(pid)}/${enc(pageId)}`, body, opts),
};
