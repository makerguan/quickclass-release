export interface LoginReport {
  deviceId: string;
  timestamp: string;
  version: string;
  platform: string;
  os: string;
  schoolName: string;
  teacherName: string;
  phone: string;
  email: string;
  action: "login";
}

/**
 * 生成一个简单的 UUID v4
 */
function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 获取或生成本地设备 ID
 * 在浏览器端使用 localStorage，服务端返回临时 ID
 */
export function getDeviceId(): string {
  if (typeof window === "undefined") {
    return `server-${generateUUID()}`;
  }

  let deviceId = localStorage.getItem("qc_device_id");
  if (!deviceId) {
    deviceId = generateUUID();
    localStorage.setItem("qc_device_id", deviceId);
  }
  return deviceId;
}

/**
 * 提取简化的平台名
 */
function getPlatform(): string {
  if (typeof window === "undefined") return "server";
  const ua = navigator.userAgent;
  if (ua.includes("Windows")) return "Windows";
  if (ua.includes("Mac OS")) return "macOS";
  if (ua.includes("Linux")) return "Linux";
  if (ua.includes("Android")) return "Android";
  if (ua.includes("iPhone") || ua.includes("iPad")) return "iOS";
  return "Unknown";
}

/**
 * 提取简化的 OS 版本
 */
function getOS(): string {
  if (typeof window === "undefined") return "server";
  const ua = navigator.userAgent;
  const match = ua.match(/(Windows NT |Mac OS X |Android )([\d._]+)/);
  if (match) return `${match[1].trim()} ${match[2]}`;
  return "Unknown";
}

/**
 * 匿名上报：教师登录后，向汇总服务器发送一条活跃记录。
 *
 * 上报内容：
 * - deviceId:    设备标识（用于去重）
 * - timestamp:   登录时间
 * - version:     应用版本
 * - schoolName:  学校名称（可识别来源）
 * - teacherName: 教师姓名（可识别来源）
 * - platform/os: 平台信息
 * - action:      "login"
 *
 * 不包含手机号、邮箱、密码等敏感信息。
 * 上报失败静默处理，不影响登录流程。
 */
export async function reportLogin(opts: {
  schoolName: string;
  teacherName: string;
  phone: string;
  email: string;
}): Promise<void> {
  const url = process.env.NEXT_PUBLIC_ANALYTICS_URL;
  if (!url) {
    return;
  }

  try {
    const payload: LoginReport = {
      deviceId: getDeviceId(),
      timestamp: new Date().toISOString(),
      version: process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0",
      platform: getPlatform(),
      os: getOS(),
      schoolName: opts.schoolName,
      teacherName: opts.teacherName,
      phone: opts.phone,
      email: opts.email,
      action: "login",
    };

    console.log("[上报调试] 发送 payload:", JSON.stringify(payload));
    console.log("[上报调试] 目标 URL:", url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    console.log("[上报调试] 响应状态:", response.status);
    clearTimeout(timer);
  } catch (err) {
    console.error("[上报调试] 请求失败:", err);
  }
}