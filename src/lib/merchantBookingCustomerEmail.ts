import { LANGUAGE_OPTIONS, resolveSupportedLocale } from "@/lib/i18n";
import type { MerchantBookingStatus } from "@/lib/merchantBookings";

type EmailCopy = {
  greeting: string;
  customerFallback: string;
  statusLabel: string;
  reminderLabel: string;
  statusSubject: Record<MerchantBookingStatus, string>;
  statusLead: Record<MerchantBookingStatus, string>;
  statusDefaultMessage: Record<MerchantBookingStatus, string>;
  reminderSubject: string;
  reminderLeadPrefix: string;
  reminderLeadSuffix: string;
  dayUnit: string;
  hourUnit: string;
  minuteUnit: string;
  additionalMessageLabel: string;
  contactMerchantLine: string;
};

const COUNTRY_EMAIL_LOCALE_OVERRIDES: Record<string, string> = {
  ES: "es-ES",
};

const EMAIL_COPY: Record<string, EmailCopy> = {
  "zh-cn": {
    greeting: "您好",
    customerFallback: "客户",
    statusLabel: "状态",
    reminderLabel: "提醒",
    statusSubject: {
      active: "预约已收到",
      confirmed: "预约已确认",
      completed: "预约已完成",
      no_show: "预约已标记为未到店",
      cancelled: "预约已取消",
    },
    statusLead: {
      active: "我们已经收到您的预约请求。",
      confirmed: "您的预约已经确认。",
      completed: "您的预约已经完成。",
      no_show: "您的预约已被标记为未到店。",
      cancelled: "您的预约已经取消。",
    },
    statusDefaultMessage: {
      active: "商家会尽快处理您的预约，请留意后续通知。",
      confirmed: "请按预约时间准时到达，如需改期请尽快联系商家。",
      completed: "感谢您的到访，期待再次为您服务。",
      no_show: "如果该标记有误，请尽快联系商家处理。",
      cancelled: "如需重新预约，请直接联系商家或重新提交预约。",
    },
    reminderSubject: "预约提醒",
    reminderLeadPrefix: "这是您预约的提醒，距离预约开始还有",
    reminderLeadSuffix: "。",
    dayUnit: "天",
    hourUnit: "小时",
    minuteUnit: "分钟",
    additionalMessageLabel: "补充说明",
    contactMerchantLine: "如需修改预约，请直接联系商家。",
  },
  "zh-tw": {
    greeting: "您好",
    customerFallback: "客戶",
    statusLabel: "狀態",
    reminderLabel: "提醒",
    statusSubject: {
      active: "預約已收到",
      confirmed: "預約已確認",
      completed: "預約已完成",
      no_show: "預約已標記為未到店",
      cancelled: "預約已取消",
    },
    statusLead: {
      active: "我們已收到您的預約請求。",
      confirmed: "您的預約已確認。",
      completed: "您的預約已完成。",
      no_show: "您的預約已被標記為未到店。",
      cancelled: "您的預約已取消。",
    },
    statusDefaultMessage: {
      active: "商家會盡快處理您的預約，請留意後續通知。",
      confirmed: "請依照預約時間準時到達，如需改期請盡快聯絡商家。",
      completed: "感謝您的到訪，期待再次為您服務。",
      no_show: "如果這個標記有誤，請盡快聯絡商家處理。",
      cancelled: "如需重新預約，請直接聯絡商家或重新提交預約。",
    },
    reminderSubject: "預約提醒",
    reminderLeadPrefix: "這是您的預約提醒，距離預約開始還有",
    reminderLeadSuffix: "。",
    dayUnit: "天",
    hourUnit: "小時",
    minuteUnit: "分鐘",
    additionalMessageLabel: "補充說明",
    contactMerchantLine: "如需修改預約，請直接聯絡商家。",
  },
  en: {
    greeting: "Hello",
    customerFallback: "Customer",
    statusLabel: "Status",
    reminderLabel: "Reminder",
    statusSubject: {
      active: "Booking received",
      confirmed: "Booking confirmed",
      completed: "Booking completed",
      no_show: "Booking marked as no-show",
      cancelled: "Booking cancelled",
    },
    statusLead: {
      active: "We have received your booking request.",
      confirmed: "Your booking has been confirmed.",
      completed: "Your booking has been completed.",
      no_show: "Your booking has been marked as no-show.",
      cancelled: "Your booking has been cancelled.",
    },
    statusDefaultMessage: {
      active: "The merchant will review it shortly. Please watch for follow-up updates.",
      confirmed: "Please arrive on time. If you need to reschedule, contact the merchant as soon as possible.",
      completed: "Thank you for your visit. We look forward to serving you again.",
      no_show: "If this status is incorrect, please contact the merchant as soon as possible.",
      cancelled: "If you still need an appointment, please contact the merchant or submit a new booking.",
    },
    reminderSubject: "Booking reminder",
    reminderLeadPrefix: "This is a reminder for your booking in",
    reminderLeadSuffix: ".",
    dayUnit: "day(s)",
    hourUnit: "hour(s)",
    minuteUnit: "minute(s)",
    additionalMessageLabel: "Additional message",
    contactMerchantLine: "If you need to change the booking, please contact the merchant.",
  },
  es: {
    greeting: "Hola",
    customerFallback: "Cliente",
    statusLabel: "Estado",
    reminderLabel: "Recordatorio",
    statusSubject: {
      active: "Reserva recibida",
      confirmed: "Reserva confirmada",
      completed: "Reserva completada",
      no_show: "Reserva marcada como no presentada",
      cancelled: "Reserva cancelada",
    },
    statusLead: {
      active: "Hemos recibido su solicitud de reserva.",
      confirmed: "Su reserva ha sido confirmada.",
      completed: "Su reserva ha sido completada.",
      no_show: "Su reserva ha sido marcada como no presentada.",
      cancelled: "Su reserva ha sido cancelada.",
    },
    statusDefaultMessage: {
      active: "El comercio la revisará en breve. Esté atento a las próximas notificaciones.",
      confirmed: "Por favor, llegue a la hora acordada. Si necesita cambiarla, contacte con el comercio lo antes posible.",
      completed: "Gracias por su visita. Esperamos atenderle de nuevo.",
      no_show: "Si este estado es incorrecto, contacte con el comercio lo antes posible.",
      cancelled: "Si todavía necesita una cita, contacte con el comercio o envíe una nueva reserva.",
    },
    reminderSubject: "Recordatorio de reserva",
    reminderLeadPrefix: "Este es un recordatorio de su reserva. Faltan",
    reminderLeadSuffix: ".",
    dayUnit: "día(s)",
    hourUnit: "hora(s)",
    minuteUnit: "minuto(s)",
    additionalMessageLabel: "Mensaje adicional",
    contactMerchantLine: "Si necesita cambiar la reserva, contacte directamente con el comercio.",
  },
  fr: {
    greeting: "Bonjour",
    customerFallback: "Client",
    statusLabel: "Statut",
    reminderLabel: "Rappel",
    statusSubject: {
      active: "Réservation reçue",
      confirmed: "Réservation confirmée",
      completed: "Réservation terminée",
      no_show: "Réservation marquée comme absente",
      cancelled: "Réservation annulée",
    },
    statusLead: {
      active: "Nous avons bien reçu votre demande de réservation.",
      confirmed: "Votre réservation a été confirmée.",
      completed: "Votre réservation a été terminée.",
      no_show: "Votre réservation a été marquée comme absente.",
      cancelled: "Votre réservation a été annulée.",
    },
    statusDefaultMessage: {
      active: "Le commerçant l'examinera sous peu. Merci de surveiller les prochaines notifications.",
      confirmed: "Merci d'arriver à l'heure prévue. Si vous devez modifier ce rendez-vous, contactez rapidement le commerçant.",
      completed: "Merci pour votre visite. Au plaisir de vous accueillir à nouveau.",
      no_show: "Si ce statut est incorrect, veuillez contacter rapidement le commerçant.",
      cancelled: "Si vous avez encore besoin d'un rendez-vous, contactez le commerçant ou effectuez une nouvelle réservation.",
    },
    reminderSubject: "Rappel de réservation",
    reminderLeadPrefix: "Ceci est un rappel pour votre réservation dans",
    reminderLeadSuffix: ".",
    dayUnit: "jour(s)",
    hourUnit: "heure(s)",
    minuteUnit: "minute(s)",
    additionalMessageLabel: "Message complémentaire",
    contactMerchantLine: "Si vous devez modifier la réservation, contactez directement le commerçant.",
  },
  de: {
    greeting: "Hallo",
    customerFallback: "Kunde",
    statusLabel: "Status",
    reminderLabel: "Erinnerung",
    statusSubject: {
      active: "Buchung eingegangen",
      confirmed: "Buchung bestätigt",
      completed: "Buchung abgeschlossen",
      no_show: "Buchung als nicht erschienen markiert",
      cancelled: "Buchung storniert",
    },
    statusLead: {
      active: "Wir haben Ihre Buchungsanfrage erhalten.",
      confirmed: "Ihre Buchung wurde bestätigt.",
      completed: "Ihre Buchung wurde abgeschlossen.",
      no_show: "Ihre Buchung wurde als nicht erschienen markiert.",
      cancelled: "Ihre Buchung wurde storniert.",
    },
    statusDefaultMessage: {
      active: "Der Händler prüft sie in Kürze. Bitte achten Sie auf weitere Benachrichtigungen.",
      confirmed: "Bitte erscheinen Sie pünktlich. Wenn Sie umbuchen müssen, kontaktieren Sie den Händler so bald wie möglich.",
      completed: "Vielen Dank für Ihren Besuch. Wir freuen uns darauf, Sie wieder begrüßen zu dürfen.",
      no_show: "Wenn dieser Status nicht korrekt ist, kontaktieren Sie bitte so bald wie möglich den Händler.",
      cancelled: "Wenn Sie weiterhin einen Termin benötigen, kontaktieren Sie den Händler oder senden Sie eine neue Buchung.",
    },
    reminderSubject: "Buchungserinnerung",
    reminderLeadPrefix: "Dies ist eine Erinnerung an Ihre Buchung in",
    reminderLeadSuffix: ".",
    dayUnit: "Tag(en)",
    hourUnit: "Stunde(n)",
    minuteUnit: "Minute(n)",
    additionalMessageLabel: "Zusätzliche Nachricht",
    contactMerchantLine: "Wenn Sie die Buchung ändern müssen, kontaktieren Sie bitte direkt den Händler.",
  },
  it: {
    greeting: "Buongiorno",
    customerFallback: "Cliente",
    statusLabel: "Stato",
    reminderLabel: "Promemoria",
    statusSubject: {
      active: "Prenotazione ricevuta",
      confirmed: "Prenotazione confermata",
      completed: "Prenotazione completata",
      no_show: "Prenotazione segnata come mancata presentazione",
      cancelled: "Prenotazione annullata",
    },
    statusLead: {
      active: "Abbiamo ricevuto la sua richiesta di prenotazione.",
      confirmed: "La sua prenotazione è stata confermata.",
      completed: "La sua prenotazione è stata completata.",
      no_show: "La sua prenotazione è stata segnata come mancata presentazione.",
      cancelled: "La sua prenotazione è stata annullata.",
    },
    statusDefaultMessage: {
      active: "Il commerciante la esaminerà a breve. Resti in attesa dei prossimi aggiornamenti.",
      confirmed: "La preghiamo di arrivare puntuale. Se deve riprogrammare, contatti il commerciante il prima possibile.",
      completed: "Grazie per la visita. Saremo lieti di servirla di nuovo.",
      no_show: "Se questo stato non è corretto, contatti il commerciante il prima possibile.",
      cancelled: "Se ha ancora bisogno di un appuntamento, contatti il commerciante o invii una nuova prenotazione.",
    },
    reminderSubject: "Promemoria prenotazione",
    reminderLeadPrefix: "Questo è un promemoria per la sua prenotazione tra",
    reminderLeadSuffix: ".",
    dayUnit: "giorno/i",
    hourUnit: "ora/e",
    minuteUnit: "minuto/i",
    additionalMessageLabel: "Messaggio aggiuntivo",
    contactMerchantLine: "Se deve modificare la prenotazione, contatti direttamente il commerciante.",
  },
  pt: {
    greeting: "Olá",
    customerFallback: "Cliente",
    statusLabel: "Estado",
    reminderLabel: "Lembrete",
    statusSubject: {
      active: "Reserva recebida",
      confirmed: "Reserva confirmada",
      completed: "Reserva concluída",
      no_show: "Reserva marcada como ausência",
      cancelled: "Reserva cancelada",
    },
    statusLead: {
      active: "Recebemos o seu pedido de reserva.",
      confirmed: "A sua reserva foi confirmada.",
      completed: "A sua reserva foi concluída.",
      no_show: "A sua reserva foi marcada como ausência.",
      cancelled: "A sua reserva foi cancelada.",
    },
    statusDefaultMessage: {
      active: "O comerciante irá analisá-la em breve. Fique atento às próximas notificações.",
      confirmed: "Chegue à hora marcada. Se precisar remarcar, contacte o comerciante o mais cedo possível.",
      completed: "Obrigado pela sua visita. Esperamos poder atendê-lo novamente.",
      no_show: "Se este estado estiver incorreto, contacte o comerciante o mais cedo possível.",
      cancelled: "Se ainda precisar de um horário, contacte o comerciante ou envie uma nova reserva.",
    },
    reminderSubject: "Lembrete de reserva",
    reminderLeadPrefix: "Este é um lembrete da sua reserva para daqui a",
    reminderLeadSuffix: ".",
    dayUnit: "dia(s)",
    hourUnit: "hora(s)",
    minuteUnit: "minuto(s)",
    additionalMessageLabel: "Mensagem adicional",
    contactMerchantLine: "Se precisar alterar a reserva, contacte diretamente o comerciante.",
  },
  ja: {
    greeting: "こんにちは",
    customerFallback: "お客様",
    statusLabel: "状態",
    reminderLabel: "リマインダー",
    statusSubject: {
      active: "予約受付のお知らせ",
      confirmed: "予約確定のお知らせ",
      completed: "予約完了のお知らせ",
      no_show: "予約が未到着として記録されました",
      cancelled: "予約キャンセルのお知らせ",
    },
    statusLead: {
      active: "ご予約リクエストを受け付けました。",
      confirmed: "ご予約が確定しました。",
      completed: "ご予約は完了しました。",
      no_show: "ご予約は未到着として記録されました。",
      cancelled: "ご予約はキャンセルされました。",
    },
    statusDefaultMessage: {
      active: "店舗にて順次確認いたします。続報をお待ちください。",
      confirmed: "当日はご予約時間までにお越しください。変更が必要な場合はお早めに店舗へご連絡ください。",
      completed: "ご来店ありがとうございました。今後ともよろしくお願いいたします。",
      no_show: "この記録に誤りがある場合は、できるだけ早く店舗へご連絡ください。",
      cancelled: "再予約が必要な場合は、店舗へ直接ご連絡いただくか、新しくご予約ください。",
    },
    reminderSubject: "予約リマインダー",
    reminderLeadPrefix: "ご予約開始まであと",
    reminderLeadSuffix: "です。",
    dayUnit: "日",
    hourUnit: "時間",
    minuteUnit: "分",
    additionalMessageLabel: "追加メッセージ",
    contactMerchantLine: "予約を変更する必要がある場合は、直接店舗へご連絡ください。",
  },
  ko: {
    greeting: "안녕하세요",
    customerFallback: "고객님",
    statusLabel: "상태",
    reminderLabel: "알림",
    statusSubject: {
      active: "예약 접수 안내",
      confirmed: "예약 확정 안내",
      completed: "예약 완료 안내",
      no_show: "예약이 미방문으로 표시되었습니다",
      cancelled: "예약 취소 안내",
    },
    statusLead: {
      active: "예약 요청이 접수되었습니다.",
      confirmed: "예약이 확정되었습니다.",
      completed: "예약이 완료되었습니다.",
      no_show: "예약이 미방문으로 표시되었습니다.",
      cancelled: "예약이 취소되었습니다.",
    },
    statusDefaultMessage: {
      active: "매장에서 곧 확인할 예정입니다. 후속 안내를 기다려 주세요.",
      confirmed: "예약 시간에 맞춰 방문해 주세요. 변경이 필요하면 가능한 빨리 매장에 연락해 주세요.",
      completed: "방문해 주셔서 감사합니다. 다시 뵙기를 기대합니다.",
      no_show: "이 상태가 잘못되었다면 가능한 빨리 매장에 연락해 주세요.",
      cancelled: "다시 예약이 필요하면 매장에 직접 문의하시거나 새 예약을 등록해 주세요.",
    },
    reminderSubject: "예약 알림",
    reminderLeadPrefix: "예약 시작까지",
    reminderLeadSuffix: "남았습니다.",
    dayUnit: "일",
    hourUnit: "시간",
    minuteUnit: "분",
    additionalMessageLabel: "추가 안내",
    contactMerchantLine: "예약을 변경해야 하면 매장에 직접 문의해 주세요.",
  },
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function hasExactEmailCopy(locale: string) {
  return Object.prototype.hasOwnProperty.call(EMAIL_COPY, locale);
}

function hasLanguageEmailCopy(language: string) {
  return Object.prototype.hasOwnProperty.call(EMAIL_COPY, language);
}

function resolveSupportedEmailLocaleCandidate(value: string | null | undefined) {
  const normalized = trimText(value);
  if (!normalized) return "";
  const resolved = resolveSupportedLocale(normalized);
  const normalizedResolved = resolved.toLowerCase();
  if (hasExactEmailCopy(normalizedResolved)) return resolved;
  const language = normalizedResolved.split("-")[0] ?? "";
  if (!hasLanguageEmailCopy(language)) return "";
  return LANGUAGE_OPTIONS.find((item) => item.code.split("-")[0]?.toLowerCase() === language)?.code ?? "";
}

function resolveCopy(locale: string | null | undefined) {
  const normalized = resolveMerchantBookingCustomerEmailLocale(locale).toLowerCase();
  if (EMAIL_COPY[normalized]) return EMAIL_COPY[normalized];
  const language = normalized.split("-")[0] ?? "";
  return EMAIL_COPY[language] ?? EMAIL_COPY.en;
}

export function getMerchantBookingCustomerEmailLanguageOptions() {
  return LANGUAGE_OPTIONS.filter((item) => Boolean(resolveSupportedEmailLocaleCandidate(item.code)));
}

export function resolveMerchantBookingCustomerEmailLocale(
  preferredLocale: string | null | undefined,
  countryCode?: string | null,
) {
  const preferred = resolveSupportedEmailLocaleCandidate(preferredLocale);
  if (preferred) return preferred;
  const normalizedCountryCode = trimText(countryCode).toUpperCase();
  const override = COUNTRY_EMAIL_LOCALE_OVERRIDES[normalizedCountryCode];
  const overrideLocale = resolveSupportedEmailLocaleCandidate(override);
  if (overrideLocale) return overrideLocale;
  const matched = LANGUAGE_OPTIONS.find((item) => item.countryCode.toUpperCase() === normalizedCountryCode);
  return resolveSupportedEmailLocaleCandidate(matched?.code) || "en-GB";
}

export function buildMerchantBookingReminderOffsetLabel(minutesBefore: number, locale: string | null | undefined) {
  const copy = resolveCopy(locale);
  if (minutesBefore % (60 * 24) === 0) {
    return `${minutesBefore / (60 * 24)} ${copy.dayUnit}`;
  }
  if (minutesBefore % 60 === 0) {
    return `${minutesBefore / 60} ${copy.hourUnit}`;
  }
  return `${minutesBefore} ${copy.minuteUnit}`;
}

export function getMerchantBookingCustomerEmailDefaultStatusMessage(
  status: MerchantBookingStatus,
  locale: string | null | undefined,
) {
  return resolveCopy(locale).statusDefaultMessage[status];
}

export function getMerchantBookingCustomerEmailStatusSubject(
  status: MerchantBookingStatus,
  merchantDisplayName: string,
  locale: string | null | undefined,
) {
  const copy = resolveCopy(locale);
  return `${copy.statusSubject[status]} - ${trimText(merchantDisplayName) || "FAOLLA"}`;
}

export function getMerchantBookingCustomerEmailStatusLead(
  status: MerchantBookingStatus,
  locale: string | null | undefined,
) {
  return resolveCopy(locale).statusLead[status];
}

export function getMerchantBookingCustomerReminderEmailSubject(
  merchantDisplayName: string,
  minutesBefore: number,
  locale: string | null | undefined,
) {
  const copy = resolveCopy(locale);
  return `${copy.reminderSubject} - ${trimText(merchantDisplayName) || "FAOLLA"} - ${buildMerchantBookingReminderOffsetLabel(minutesBefore, locale)}`;
}

export function getMerchantBookingCustomerReminderLead(
  minutesBefore: number,
  locale: string | null | undefined,
) {
  const copy = resolveCopy(locale);
  return `${copy.reminderLeadPrefix} ${buildMerchantBookingReminderOffsetLabel(minutesBefore, locale)}${copy.reminderLeadSuffix}`;
}

export function getMerchantBookingCustomerEmailCustomerFallback(locale: string | null | undefined) {
  return resolveCopy(locale).customerFallback;
}

export function getMerchantBookingCustomerEmailGreeting(locale: string | null | undefined) {
  return resolveCopy(locale).greeting;
}

export function getMerchantBookingCustomerEmailAdditionalMessageLabel(locale: string | null | undefined) {
  return resolveCopy(locale).additionalMessageLabel;
}

export function getMerchantBookingCustomerEmailContactMerchantLine(locale: string | null | undefined) {
  return resolveCopy(locale).contactMerchantLine;
}

export function getMerchantBookingCustomerEmailStatusLabel(locale: string | null | undefined) {
  return resolveCopy(locale).statusLabel;
}

export function getMerchantBookingCustomerEmailReminderLabel(locale: string | null | undefined) {
  return resolveCopy(locale).reminderLabel;
}
