const storageCodes = new Set([
  "booking_atomic_conflict", "booking_atomic_storage_unavailable", "booking_atomic_storage_unconfirmed",
  "booking_atomic_inactive", "booking_atomic_protocol_mismatch", "booking_atomic_store_corrupt",
  "booking_atomic_invalid_configuration", "booking_atomic_invalid_records", "booking_atomic_command_required",
  "booking_atomic_invalid_mutation", "booking_atomic_legacy_writer_fenced", "booking_atomic_invalid_storage_response",
]);

export type BookingWorkbenchSaveFailure = { message: string; code: string; reference: string };

// Database/provider messages can contain customer data. Only fixed codes may
// cross the diagnostic boundary; never include raw Error messages or bodies.
export function bookingWorkbenchDiagnosticCode(error: unknown) {
  return error instanceof Error && storageCodes.has(error.message) ? error.message : "booking_workbench_failed";
}

export function bookingWorkbenchDiagnosticDetails(error: unknown) {
  const type = error instanceof Error && ["Error", "TypeError", "RangeError", "AbortError", "TimeoutError"].includes(error.name) ? error.name : "Error";
  const frame = error instanceof Error ? (error.stack ?? "").split("\n").filter((line) => /^\s*at /.test(line))
    .map((line) => line.match(/\.next\/server\/(chunks\/[A-Za-z0-9_.\/-]+\.js:\d+:\d+)/)?.[1]).find(Boolean) ?? "" : "";
  return { reason: bookingWorkbenchDiagnosticCode(error), type, frame };
}

export function getBookingWorkbenchSaveFailure(status: number, payload: unknown, locale = "zh-CN"): BookingWorkbenchSaveFailure {
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const rawCode = typeof body.reason === "string" ? body.reason : body.error;
  const code = typeof rawCode === "string" && (storageCodes.has(rawCode) || ["unauthorized", "permission_denied", "invalid_booking_time_zone", "invalid_booking_reply_to"].includes(rawCode))
    ? rawCode : "booking_workbench_failed";
  const reference = typeof body.reference === "string" && /^[a-f0-9]{16}$/.test(body.reference) ? body.reference : "";
  const zh = locale.startsWith("zh"), es = locale.startsWith("es");
  let message = zh ? "保存结果暂未确认，修改仍保留在本页。请勿刷新，可重试保存。" : es ? "No se ha confirmado el guardado. Los cambios siguen en esta página. No recargues; puedes reintentar." : "Saving could not be confirmed. Your edits are still on this page. Do not reload; you can retry saving.";
  if (status === 401 || code === "unauthorized") {
    message = zh ? "登录验证未通过，修改仍保留在本页。请先恢复登录后再重试。" : es ? "La sesión no se ha validado. Los cambios se conservan; recupera la sesión antes de reintentar." : "Your session could not be verified. Your edits are retained; restore your sign-in before retrying.";
  } else if (status === 403 || code === "permission_denied") {
    message = zh ? "当前账号没有保存权限，修改仍保留在本页。请核对账号与预约设置权限。" : es ? "Esta cuenta no tiene permiso para guardar. Los cambios se conservan; comprueba la cuenta y sus permisos." : "This account cannot save these settings. Your edits are retained; check your account and permissions.";
  } else if (code === "invalid_booking_time_zone") {
    message = zh ? "预约时区无效，请选择有效的 IANA 时区后重试。" : es ? "La zona horaria no es válida. Elige una zona IANA válida y reintenta." : "The booking time zone is invalid. Choose a valid IANA zone and retry.";
  } else if (code === "invalid_booking_reply_to") {
    message = zh ? "商户回复邮箱无效，请在提醒通知中填写一个有效邮箱后重试。" : es ? "El correo de respuesta no es válido. Corrígelo en las notificaciones antes de reintentar." : "The merchant reply-to email is invalid. Correct it in notifications before retrying.";
  } else if (code === "booking_atomic_conflict") {
    message = zh ? "保存时遇到并发更新，修改仍保留在本页。请重试保存。" : es ? "Ha habido una actualización simultánea. Los cambios se conservan; reintenta el guardado." : "A concurrent update prevented saving. Your edits are retained; retry saving.";
  }
  return { message, code, reference };
}
