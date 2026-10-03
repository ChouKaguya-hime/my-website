'use strict';

/**
 * api-health —— 习惯规划板的健康检查接口
 *
 * 它是整个项目第一个跑在云上的东西，作用只有一个：
 * **证明「这个公网地址返回的，是我刚部署的那份代码」**。
 *
 * 所以返回体里故意放了三样东西，都不是装饰：
 *   envId      —— 环境 ID。和我在控制台看到的一不一样，就说明打错了环境。
 *   version    —— 契约版本。接口改了这里要跟着动，前端好判断对不对得上。
 *   checkedAt  —— 这次的服务器时间。是个「刚生成的」时间，就说明不是缓存。
 *
 * 部署方式：腾讯云开发 CloudBase 云函数（Node.js）
 * 对应文档：仓库根目录的 api-contract.md
 */

// ---------- 从运行环境里读出来的事实（不写死，免得和真实环境对不上）----------
const ENV_ID = process.env.TCB_ENV || process.env.SCF_NAMESPACE || 'unknown';
const REGION = process.env.TENCENTCLOUD_REGION || process.env.TCB_REGION || 'unknown';
const RUNTIME = process.version; // 例如 v18.15.0

// ---------- 这份代码自己的身份（改了才动）----------
const SERVICE = 'habit-board-api';
const FUNC_NAME = 'api-health';
const CONTRACT_VERSION = 'v1';

// 同一个容器被重复使用时，这个时间不会归零 —— 用来区分「冷启动」和「复用」
const CONTAINER_STARTED_AT = Date.now();

/**
 * 统一出口：控制 HTTP 状态码、Content-Type 和缓存头
 * （云开发 HTTP 访问服务认这种「集成响应」写法：带 statusCode / headers / body 三个键）
 */
function reply(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // 网关默认会给 JSON 响应补一个 content-disposition: attachment，
      // 那会让浏览器把结果当成文件「下载」而不是显示出来。
      // 探活时人是要用肉眼看返回体的，所以这里明确写 inline。
      'content-disposition': 'inline',
      // 健康检查绝不能返回缓存 —— 否则「打不通」和「其实是缓存的旧结果」分不清
      'cache-control': 'no-store',
    },
    body: JSON.stringify(payload),
  };
}

exports.main = async (event, context) => {
  // event 在直接调用时可能没有 httpMethod，所以只在它存在时才判方法
  const method = event && (event.httpMethod || event.http_method);
  if (method && String(method).toUpperCase() !== 'GET') {
    return reply(405, {
      ok: false,
      service: SERVICE,
      function: FUNC_NAME,
      version: CONTRACT_VERSION,
      error: 'method_not_allowed',
      message: '这个接口只接受 GET',
    });
  }

  return reply(200, {
    ok: true,
    service: SERVICE,
    function: FUNC_NAME,
    version: CONTRACT_VERSION,
    envId: ENV_ID,
    region: REGION,
    runtime: RUNTIME,
    requestId: (context && (context.request_id || context.requestId)) || 'unknown',
    checkedAt: new Date().toISOString(), // 统一 UTC，带 Z 结尾
    containerAliveSec: Math.round((Date.now() - CONTAINER_STARTED_AT) / 1000),
  });
};
