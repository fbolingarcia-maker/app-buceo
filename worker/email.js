// Emails de DivingSlot desde el Worker: un solo idioma por email, el que eligió el cliente en la app.
// Envío por Cloudflare Email Service (binding EMAIL), por Resend (RESEND_API_KEY) o, si no, por SMTP con TLS (SMTP_HOST, SMTP_PORT=465, SMTP_USER, SMTP_PASS),
// p. ej. la contraseña de aplicación de Gmail que ya usaba Supabase.

// Idioma de los emails: uno solo, el que el cliente eligió en la app (divers.locale, o la cabecera X-Lang de la petición).
// Si no se sabe o no está traducido, inglés.
export const MAIL_LANGS = ['es', 'en', 'de', 'ko', 'ja', 'zh']
export const mailLang = (x) => { const l = String(x || '').toLowerCase().replace('_', '-').split('-')[0]; return MAIL_LANGS.includes(l) ? l : 'en' }
export const reqLang = (req) => { const l = String(req?.headers?.get('X-Lang') || '').toLowerCase().split('-')[0]; return MAIL_LANGS.includes(l) ? l : null }
const LOC = { es: 'es-ES', en: 'en-GB', de: 'de-DE', ko: 'ko-KR', ja: 'ja-JP', zh: 'zh-CN' }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const button = (url, label) => `<p><a href="${esc(url)}" style="background:#0b5e8a;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600">${label}</a></p>`
const foot = (s) => `<p style="color:#5d7282;font-size:13px">${s}</p>`
const note = (s) => `<p style="background:#f3f6f8;padding:10px 12px;border-radius:8px">${s}</p>`
const wrap = (lang, body) => `<div lang="${lang}" style="font-family:-apple-system,Segoe UI,Roboto,'Noto Sans',sans-serif;max-width:520px">${body}</div>`
const b = (s) => `<b>${esc(s)}</b>`
// Fecha y hora de Manila en el idioma del email
const when = (iso, lang) => new Date(iso).toLocaleString(LOC[lang], { timeZone: 'Asia/Manila', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
const day = (ymd, lang) => new Date(ymd + 'T00:00:00+08:00').toLocaleDateString(LOC[lang], { timeZone: 'Asia/Manila', day: 'numeric', month: 'long', year: 'numeric' })
const peso = (n) => '₱' + Number(n || 0).toLocaleString('en-US')

// Textos. Las funciones reciben trozos ya escapados (HTML seguro); los asuntos reciben texto plano.
const S = {
  es: {
    confirmSubj: 'Confirma tu cuenta de DivingSlot', confirmBody: 'Hola. Pulsa el botón para confirmar tu cuenta.', confirmBtn: 'Confirmar cuenta', confirmFoot: 'Si no has creado una cuenta en DivingSlot, ignora este email.',
    recoverySubj: 'Nueva contraseña de DivingSlot', recoveryBody: 'Pulsa el botón para crear una contraseña nueva.', recoveryBtn: 'Crear contraseña', ignoreFoot: 'Si no lo has pedido tú, ignora este email.',
    reauthSubj: 'Tu código de DivingSlot', reauthBody: 'Escribe este código en la app para confirmar el cambio de contraseña.', reauthFoot: 'Caduca en 10 minutos. Si no lo has pedido tú, cambia tu contraseña.',
    verifiedSubj: 'Tu centro ya está verificado', reviewSubj: 'Revisión de tu centro', verifiedBody: (n) => `${n} ya está verificado: puedes publicar salidas y recibir reservas.`, reviewBody: (n) => `Hemos revisado ${n} y necesitamos algún cambio.`, openBtn: 'Abrir DivingSlot',
    tomorrowSubj: (c) => `Mañana buceas con ${c}`, paySubj: 'Paga el resto de tu salida',
    cashBody: (c, w, d) => `Tu salida con ${c} es el ${w}. Lleva ${d} en efectivo para pagar el resto en el centro.`,
    payBody: (c, w, d) => `Tu salida con ${c} es el ${w}. Te quedan ${d} por pagar: hazlo ahora con GCash o tarjeta, o en efectivo en el centro.`,
    viewBtn: 'Ver mi reserva', payBtn: 'Pagar el resto', cardFoot: 'Lleva tu tarjeta de certificación.',
    ready: 'Todo listo para tu salida. Aquí tienes lo que necesitas.', departs: 'Salida', centre: 'Centro', boat: 'Barco', spots: 'Plazas', dives: (n) => `${n} inmersiones`, map: 'Mapa', sea: 'Mar previsto', payment: 'Pago',
    seaGood: 'Buenas condiciones', seaModerate: 'Mar algo movido', seaRough: 'Mar movido: el centro puede cancelar (si cancela, se devuelve todo)',
    paid: 'Todo pagado', dueCash: (d) => `Lleva ${d} en efectivo para pagar el resto en el centro.`, dueApp: (d) => `Quedan ${d}: págalo en la app con GCash o tarjeta, o en efectivo en el centro.`,
    bring: 'Lleva tu tarjeta de certificación y llega 15 minutos antes. No vueles en las 18 h siguientes a bucear.',
    noInsurance: (a) => `No tenemos tu seguro de buceo en el perfil. Muchos centros lo piden. ${a}Añadirlo</a>`, forecastFoot: 'Previsión de Open-Meteo, orientativa: el centro decide si sale.',
    insSubj: 'Tu seguro de buceo caduca pronto', insBody: (p, d) => `Tu seguro de buceo (${p}) caduca el ${d}. Renuévalo antes de tu próxima salida y actualiza la fecha en tu perfil.`, profileBtn: 'Actualizar mi perfil', danLink: 'Ver seguros DAN', insFoot: 'Recibes este aviso porque indicaste la fecha en tu perfil. DivingSlot no vende seguros.',
    waitSubj: (c) => `Plaza libre con ${c}`, waitBody: (c, w, m) => `Se ha liberado una plaza en la salida de ${c} del ${w}. Está retenida para ti ${m}: paga la señal para confirmarla.`, mins: (m) => `${m} minutos`, waitBtn: 'Pagar y confirmar', waitFoot: 'Si no pagas a tiempo, la plaza pasa al siguiente de la lista.',
    buddySubj: (n, d) => `${n} busca buddy en ${d}`, buddyBody: (n, c, w) => `${n} ha reservado con ${c} el ${w} y busca buddy.`, tripBtn: 'Ver la salida', buddyFoot: 'Recibes esto porque marcaste «Busco buddy» y sigues este destino. Puedes quitarlo en tu perfil.',
    lmSubj: (d, f) => `Última hora en ${d}: ${f === 1 ? '1 plaza' : f + ' plazas'}`, lmBody: (c, f, w, pr) => `${c} tiene ${f === 1 ? '1 plaza libre' : f + ' plazas libres'} en el barco del ${w}, ${pr}.`, lmDisc: (u, p) => `a ${u} en vez de ${p}`, lmPrice: (p) => `por ${p}`, lmFoot: 'Recibes este aviso porque lo activaste en tu perfil (Avisos de última hora). Puedes quitarlo allí.',
  },
  en: {
    confirmSubj: 'Confirm your DivingSlot account', confirmBody: 'Hi. Tap the button to confirm your account.', confirmBtn: 'Confirm account', confirmFoot: "If you didn't sign up for DivingSlot, you can ignore this email.",
    recoverySubj: 'Reset your DivingSlot password', recoveryBody: 'Tap the button to create a new password.', recoveryBtn: 'Reset password', ignoreFoot: "If you didn't ask for this, you can ignore this email.",
    reauthSubj: 'Your DivingSlot code', reauthBody: 'Enter this code in the app to confirm your password change.', reauthFoot: "It expires in 10 minutes. If you didn't ask for it, change your password.",
    verifiedSubj: 'Your centre is verified', reviewSubj: 'Your centre review', verifiedBody: (n) => `${n} is verified: you can publish trips and take bookings.`, reviewBody: (n) => `We reviewed ${n} and need some changes.`, openBtn: 'Open DivingSlot',
    tomorrowSubj: (c) => `Diving tomorrow with ${c}`, paySubj: 'Pay the rest of your dive trip',
    cashBody: (c, w, d) => `Your trip with ${c} is on ${w}. Bring ${d} in cash to pay the rest at the centre.`,
    payBody: (c, w, d) => `Your trip with ${c} is on ${w}. ${d} is still due: pay now by GCash or card, or in cash at the centre.`,
    viewBtn: 'View my booking', payBtn: 'Pay the rest', cardFoot: 'Bring your certification card.',
    ready: "You're all set for your trip. Here's what you need.", departs: 'Departs', centre: 'Centre', boat: 'Boat', spots: 'Spots', dives: (n) => `${n} dives`, map: 'Map', sea: 'Sea forecast', payment: 'Payment',
    seaGood: 'Good conditions', seaModerate: 'Slightly choppy sea', seaRough: 'Rough sea: the centre may cancel (full refund if it does)',
    paid: 'Fully paid', dueCash: (d) => `Bring ${d} in cash to pay the rest at the centre.`, dueApp: (d) => `${d} is still due: pay in the app by GCash or card, or in cash at the centre.`,
    bring: "Bring your certification card and arrive 15 minutes early. Don't fly within 18 h after diving.",
    noInsurance: (a) => `We don't have your dive insurance on file. Many centres ask for it. ${a}Add it</a>`, forecastFoot: 'Forecast by Open-Meteo, for guidance only: the centre decides whether to go out.',
    insSubj: 'Your dive insurance expires soon', insBody: (p, d) => `Your dive insurance (${p}) expires on ${d}. Renew it before your next trip and update the date in your profile.`, profileBtn: 'Update my profile', danLink: 'See DAN plans', insFoot: 'You get this because you added the date to your profile. DivingSlot does not sell insurance.',
    waitSubj: (c) => `A spot opened up with ${c}`, waitBody: (c, w, m) => `A spot opened up on the ${c} trip on ${w}. It is held for you for ${m}: pay the deposit to confirm it.`, mins: (m) => `${m} minutes`, waitBtn: 'Pay and confirm', waitFoot: 'If you do not pay in time, the spot goes to the next person on the list.',
    buddySubj: (n, d) => `${n} is looking for a buddy in ${d}`, buddyBody: (n, c, w) => `${n} booked with ${c} on ${w} and is looking for a buddy.`, tripBtn: 'See the trip', buddyFoot: 'You get this because you are looking for a buddy and follow this destination. You can turn it off in your profile.',
    lmSubj: (d, f) => `Last-minute ${f === 1 ? 'spot' : 'spots'} in ${d}`, lmBody: (c, f, w, pr) => `${c} has ${f === 1 ? '1 spot' : f + ' spots'} left on the boat on ${w}, ${pr}.`, lmDisc: (u, p) => `at ${u} instead of ${p}`, lmPrice: (p) => `for ${p}`, lmFoot: 'You get this alert because you turned on last-minute alerts in your profile. You can turn it off there.',
  },
  de: {
    confirmSubj: 'Bestätige dein DivingSlot-Konto', confirmBody: 'Hallo. Tippe auf die Schaltfläche, um dein Konto zu bestätigen.', confirmBtn: 'Konto bestätigen', confirmFoot: 'Wenn du kein DivingSlot-Konto erstellt hast, ignoriere diese E-Mail.',
    recoverySubj: 'Neues Passwort für DivingSlot', recoveryBody: 'Tippe auf die Schaltfläche, um ein neues Passwort zu erstellen.', recoveryBtn: 'Passwort erstellen', ignoreFoot: 'Wenn du das nicht angefordert hast, ignoriere diese E-Mail.',
    reauthSubj: 'Dein DivingSlot-Code', reauthBody: 'Gib diesen Code in der App ein, um die Passwortänderung zu bestätigen.', reauthFoot: 'Er läuft in 10 Minuten ab. Wenn du ihn nicht angefordert hast, ändere dein Passwort.',
    verifiedSubj: 'Deine Tauchbasis ist verifiziert', reviewSubj: 'Prüfung deiner Tauchbasis', verifiedBody: (n) => `${n} ist verifiziert: Du kannst Ausfahrten veröffentlichen und Buchungen annehmen.`, reviewBody: (n) => `Wir haben ${n} geprüft und brauchen noch einige Änderungen.`, openBtn: 'DivingSlot öffnen',
    tomorrowSubj: (c) => `Morgen tauchst du mit ${c}`, paySubj: 'Bezahle den Rest deiner Ausfahrt',
    cashBody: (c, w, d) => `Deine Ausfahrt mit ${c} ist am ${w}. Bring ${d} in bar mit, um den Rest an der Basis zu bezahlen.`,
    payBody: (c, w, d) => `Deine Ausfahrt mit ${c} ist am ${w}. Offen sind noch ${d}: Bezahle jetzt per GCash oder Karte oder bar an der Basis.`,
    viewBtn: 'Meine Buchung ansehen', payBtn: 'Rest bezahlen', cardFoot: 'Bring deine Brevetkarte mit.',
    ready: 'Alles bereit für deine Ausfahrt. Hier ist alles, was du brauchst.', departs: 'Abfahrt', centre: 'Tauchbasis', boat: 'Boot', spots: 'Plätze', dives: (n) => `${n} Tauchgänge`, map: 'Karte', sea: 'Seegang (Vorhersage)', payment: 'Zahlung',
    seaGood: 'Gute Bedingungen', seaModerate: 'Leicht bewegte See', seaRough: 'Raue See: Die Basis kann absagen (dann gibt es alles zurück)',
    paid: 'Vollständig bezahlt', dueCash: (d) => `Bring ${d} in bar mit, um den Rest an der Basis zu bezahlen.`, dueApp: (d) => `Offen sind noch ${d}: in der App per GCash oder Karte oder bar an der Basis bezahlen.`,
    bring: 'Bring deine Brevetkarte mit und sei 15 Minuten früher da. Fliege nicht innerhalb von 18 h nach dem Tauchen.',
    noInsurance: (a) => `Wir haben keine Tauchversicherung in deinem Profil. Viele Basen verlangen eine. ${a}Hinzufügen</a>`, forecastFoot: 'Vorhersage von Open-Meteo, nur zur Orientierung: Die Basis entscheidet, ob sie rausfährt.',
    insSubj: 'Deine Tauchversicherung läuft bald ab', insBody: (p, d) => `Deine Tauchversicherung (${p}) läuft am ${d} ab. Verlängere sie vor deiner nächsten Ausfahrt und aktualisiere das Datum in deinem Profil.`, profileBtn: 'Profil aktualisieren', danLink: 'DAN-Versicherungen ansehen', insFoot: 'Du bekommst diese Nachricht, weil du das Datum in deinem Profil angegeben hast. DivingSlot verkauft keine Versicherungen.',
    waitSubj: (c) => `Freier Platz bei ${c}`, waitBody: (c, w, m) => `Bei der Ausfahrt von ${c} am ${w} ist ein Platz frei geworden. Er ist ${m} für dich reserviert: Zahle die Anzahlung, um ihn zu bestätigen.`, mins: (m) => `${m} Minuten`, waitBtn: 'Bezahlen und bestätigen', waitFoot: 'Wenn du nicht rechtzeitig zahlst, geht der Platz an die nächste Person auf der Liste.',
    buddySubj: (n, d) => `${n} sucht einen Buddy in ${d}`, buddyBody: (n, c, w) => `${n} hat bei ${c} für ${w} gebucht und sucht einen Buddy.`, tripBtn: 'Ausfahrt ansehen', buddyFoot: 'Du bekommst das, weil du einen Buddy suchst und diesem Ziel folgst. Du kannst es in deinem Profil abschalten.',
    lmSubj: (d, f) => `Last Minute in ${d}: ${f === 1 ? '1 Platz' : f + ' Plätze'}`, lmBody: (c, f, w, pr) => `${c} hat ${f === 1 ? '1 freien Platz' : f + ' freie Plätze'} auf dem Boot am ${w}, ${pr}.`, lmDisc: (u, p) => `für ${u} statt ${p}`, lmPrice: (p) => `für ${p}`, lmFoot: 'Du bekommst diese Nachricht, weil du Last-Minute-Hinweise in deinem Profil aktiviert hast. Dort kannst du sie abschalten.',
  },
  ko: {
    confirmSubj: 'DivingSlot 계정을 확인하세요', confirmBody: '안녕하세요. 버튼을 눌러 계정을 확인하세요.', confirmBtn: '계정 확인', confirmFoot: 'DivingSlot 계정을 만들지 않았다면 이 이메일은 무시하세요.',
    recoverySubj: 'DivingSlot 새 비밀번호', recoveryBody: '버튼을 눌러 새 비밀번호를 만드세요.', recoveryBtn: '비밀번호 만들기', ignoreFoot: '직접 요청하지 않았다면 이 이메일은 무시하세요.',
    reauthSubj: 'DivingSlot 인증 코드', reauthBody: '앱에 이 코드를 입력해 비밀번호 변경을 확인하세요.', reauthFoot: '10분 후 만료됩니다. 직접 요청하지 않았다면 비밀번호를 변경하세요.',
    verifiedSubj: '센터 인증이 완료되었습니다', reviewSubj: '센터 검토 결과', verifiedBody: (n) => `${n} 인증이 완료되었습니다. 이제 트립을 게시하고 예약을 받을 수 있습니다.`, reviewBody: (n) => `${n}을(를) 검토했으며 몇 가지 수정이 필요합니다.`, openBtn: 'DivingSlot 열기',
    tomorrowSubj: (c) => `내일 ${c}에서 다이빙합니다`, paySubj: '트립 잔액을 결제하세요',
    cashBody: (c, w, d) => `${c} 트립은 ${w}입니다. 센터에서 잔액을 낼 수 있도록 현금 ${d}을(를) 준비하세요.`,
    payBody: (c, w, d) => `${c} 트립은 ${w}입니다. 남은 금액은 ${d}입니다. 지금 GCash나 카드로 결제하거나 센터에서 현금으로 내세요.`,
    viewBtn: '내 예약 보기', payBtn: '잔액 결제', cardFoot: '자격증 카드를 가져오세요.',
    ready: '트립 준비가 끝났습니다. 필요한 정보는 다음과 같습니다.', departs: '출발', centre: '센터', boat: '보트', spots: '자리', dives: (n) => `다이빙 ${n}회`, map: '지도', sea: '바다 예보', payment: '결제',
    seaGood: '좋은 조건', seaModerate: '바다가 약간 거칩니다', seaRough: '바다가 거칩니다. 센터가 취소할 수 있습니다(취소 시 전액 환불)',
    paid: '전액 결제됨', dueCash: (d) => `센터에서 잔액을 낼 수 있도록 현금 ${d}을(를) 준비하세요.`, dueApp: (d) => `남은 금액은 ${d}입니다. 앱에서 GCash나 카드로 결제하거나 센터에서 현금으로 내세요.`,
    bring: '자격증 카드를 가지고 15분 일찍 오세요. 다이빙 후 18시간 동안은 비행기를 타지 마세요.',
    noInsurance: (a) => `프로필에 다이빙 보험이 없습니다. 많은 센터에서 보험을 요구합니다. ${a}추가하기</a>`, forecastFoot: 'Open-Meteo 예보로 참고용입니다. 출항 여부는 센터가 결정합니다.',
    insSubj: '다이빙 보험이 곧 만료됩니다', insBody: (p, d) => `다이빙 보험(${p})이 ${d}에 만료됩니다. 다음 트립 전에 갱신하고 프로필의 날짜를 업데이트하세요.`, profileBtn: '프로필 업데이트', danLink: 'DAN 보험 보기', insFoot: '프로필에 날짜를 입력했기 때문에 이 알림을 받습니다. DivingSlot은 보험을 판매하지 않습니다.',
    waitSubj: (c) => `${c}에 자리가 났습니다`, waitBody: (c, w, m) => `${w} ${c} 트립에 자리가 났습니다. ${m} 동안 자리를 잡아 두었습니다. 예약금을 결제해 확정하세요.`, mins: (m) => `${m}분`, waitBtn: '결제하고 확정', waitFoot: '제때 결제하지 않으면 자리는 대기자 명단의 다음 사람에게 넘어갑니다.',
    buddySubj: (n, d) => `${n}님이 ${d}에서 버디를 찾고 있습니다`, buddyBody: (n, c, w) => `${n}님이 ${w} ${c} 트립을 예약했고 버디를 찾고 있습니다.`, tripBtn: '트립 보기', buddyFoot: '버디를 찾고 있고 이 지역을 팔로우하고 있어 이 알림을 받습니다. 프로필에서 끌 수 있습니다.',
    lmSubj: (d, f) => `${d} 라스트 미닛: ${f}자리`, lmBody: (c, f, w, pr) => `${c}의 ${w} 보트에 ${f}자리가 남았습니다. ${pr}.`, lmDisc: (u, p) => `${p} 대신 ${u}`, lmPrice: (p) => `가격 ${p}`, lmFoot: '프로필에서 라스트 미닛 알림을 켰기 때문에 이 알림을 받습니다. 그곳에서 끌 수 있습니다.',
  },
  ja: {
    confirmSubj: 'DivingSlot アカウントの確認', confirmBody: 'こんにちは。ボタンを押してアカウントを確認してください。', confirmBtn: 'アカウントを確認', confirmFoot: 'DivingSlot のアカウントを作成していない場合は、このメールを無視してください。',
    recoverySubj: 'DivingSlot の新しいパスワード', recoveryBody: 'ボタンを押して新しいパスワードを作成してください。', recoveryBtn: 'パスワードを作成', ignoreFoot: 'ご自身で依頼していない場合は、このメールを無視してください。',
    reauthSubj: 'DivingSlot の確認コード', reauthBody: 'パスワードの変更を確定するには、アプリにこのコードを入力してください。', reauthFoot: '有効期限は10分です。ご自身で依頼していない場合は、パスワードを変更してください。',
    verifiedSubj: 'センターの認証が完了しました', reviewSubj: 'センターの審査結果', verifiedBody: (n) => `${n} の認証が完了しました。ツアーを公開して予約を受け付けられます。`, reviewBody: (n) => `${n} を審査しましたが、いくつか修正が必要です。`, openBtn: 'DivingSlot を開く',
    tomorrowSubj: (c) => `明日は ${c} でダイビング`, paySubj: 'ツアーの残金をお支払いください',
    cashBody: (c, w, d) => `${c} のツアーは ${w} です。センターで残金を払うため、現金 ${d} をお持ちください。`,
    payBody: (c, w, d) => `${c} のツアーは ${w} です。残金は ${d} です。今すぐ GCash かカードで、またはセンターで現金でお支払いください。`,
    viewBtn: '予約を見る', payBtn: '残金を支払う', cardFoot: '認定証カードをお持ちください。',
    ready: 'ツアーの準備が整いました。必要な情報はこちらです。', departs: '出発', centre: 'センター', boat: 'ボート', spots: '席数', dives: (n) => `${n}ダイブ`, map: '地図', sea: '海況予報', payment: 'お支払い',
    seaGood: '良好なコンディション', seaModerate: 'やや波あり', seaRough: '海が荒れています。センターが中止する場合があります（中止時は全額返金）',
    paid: '全額支払い済み', dueCash: (d) => `センターで残金を払うため、現金 ${d} をお持ちください。`, dueApp: (d) => `残金は ${d} です。アプリで GCash かカードで、またはセンターで現金でお支払いください。`,
    bring: '認定証カードを持って15分前にお越しください。ダイビング後18時間は飛行機に乗らないでください。',
    noInsurance: (a) => `プロフィールにダイビング保険が登録されていません。多くのセンターで必要です。${a}追加する</a>`, forecastFoot: 'Open-Meteo の予報で、目安です。出港するかどうかはセンターが判断します。',
    insSubj: 'ダイビング保険の期限がまもなく切れます', insBody: (p, d) => `ダイビング保険（${p}）の期限は ${d} です。次のツアーの前に更新し、プロフィールの日付を更新してください。`, profileBtn: 'プロフィールを更新', danLink: 'DAN の保険を見る', insFoot: 'プロフィールに日付を入力したため、この通知が届いています。DivingSlot は保険を販売していません。',
    waitSubj: (c) => `${c} に空きが出ました`, waitBody: (c, w, m) => `${w} の ${c} のツアーに空きが出ました。${m}間あなたのために確保しています。デポジットを支払って確定してください。`, mins: (m) => `${m}分`, waitBtn: '支払って確定', waitFoot: '期限内に支払わない場合、席はキャンセル待ちの次の方に移ります。',
    buddySubj: (n, d) => `${n} さんが ${d} でバディを探しています`, buddyBody: (n, c, w) => `${n} さんが ${w} の ${c} のツアーを予約し、バディを探しています。`, tripBtn: 'ツアーを見る', buddyFoot: 'バディを探していて、このエリアをフォローしているため届いています。プロフィールでオフにできます。',
    lmSubj: (d, f) => `${d} の直前割：残り${f}席`, lmBody: (c, f, w, pr) => `${c} の ${w} のボートに残り${f}席があります。${pr}。`, lmDisc: (u, p) => `${p} のところ ${u}`, lmPrice: (p) => `料金 ${p}`, lmFoot: 'プロフィールで直前割の通知をオンにしたため届いています。そこでオフにできます。',
  },
  zh: {
    confirmSubj: '确认你的 DivingSlot 账户', confirmBody: '你好。点击按钮确认你的账户。', confirmBtn: '确认账户', confirmFoot: '如果你没有注册 DivingSlot，请忽略这封邮件。',
    recoverySubj: 'DivingSlot 新密码', recoveryBody: '点击按钮创建新密码。', recoveryBtn: '创建密码', ignoreFoot: '如果不是你本人申请的，请忽略这封邮件。',
    reauthSubj: '你的 DivingSlot 验证码', reauthBody: '在应用中输入此验证码以确认修改密码。', reauthFoot: '10 分钟后失效。如果不是你本人申请的，请修改密码。',
    verifiedSubj: '你的潜水中心已通过认证', reviewSubj: '潜水中心审核结果', verifiedBody: (n) => `${n} 已通过认证：你可以发布行程并接受预订。`, reviewBody: (n) => `我们审核了 ${n}，还需要做一些修改。`, openBtn: '打开 DivingSlot',
    tomorrowSubj: (c) => `明天和 ${c} 去潜水`, paySubj: '支付行程尾款',
    cashBody: (c, w, d) => `你和 ${c} 的行程在 ${w}。请带 ${d} 现金到潜水中心支付尾款。`,
    payBody: (c, w, d) => `你和 ${c} 的行程在 ${w}。还需支付 ${d}：现在用 GCash 或银行卡支付，或到潜水中心付现金。`,
    viewBtn: '查看我的预订', payBtn: '支付尾款', cardFoot: '请带上你的潜水证书卡。',
    ready: '行程已准备就绪。以下是你需要的信息。', departs: '出发', centre: '潜水中心', boat: '船', spots: '位置', dives: (n) => `${n} 次潜水`, map: '地图', sea: '海况预报', payment: '付款',
    seaGood: '海况良好', seaModerate: '海面略有风浪', seaRough: '风浪较大：潜水中心可能取消（取消将全额退款）',
    paid: '已全额支付', dueCash: (d) => `请带 ${d} 现金到潜水中心支付尾款。`, dueApp: (d) => `还需支付 ${d}：在应用中用 GCash 或银行卡支付，或到潜水中心付现金。`,
    bring: '请带上潜水证书卡并提前 15 分钟到达。潜水后 18 小时内不要乘坐飞机。',
    noInsurance: (a) => `你的个人资料中没有潜水保险。很多潜水中心会要求提供。${a}添加</a>`, forecastFoot: '预报来自 Open-Meteo，仅供参考：是否出海由潜水中心决定。',
    insSubj: '你的潜水保险即将到期', insBody: (p, d) => `你的潜水保险（${p}）将于 ${d} 到期。请在下次行程前续保，并在个人资料中更新日期。`, profileBtn: '更新个人资料', danLink: '查看 DAN 保险', insFoot: '你收到此提醒是因为你在个人资料中填写了日期。DivingSlot 不销售保险。',
    waitSubj: (c) => `${c} 有空位了`, waitBody: (c, w, m) => `${c} 在 ${w} 的行程空出了一个位置，已为你保留 ${m}：支付定金即可确认。`, mins: (m) => `${m} 分钟`, waitBtn: '支付并确认', waitFoot: '如果没有按时支付，位置将转给候补名单中的下一位。',
    buddySubj: (n, d) => `${n} 正在 ${d} 寻找潜伴`, buddyBody: (n, c, w) => `${n} 预订了 ${c} 在 ${w} 的行程，正在寻找潜伴。`, tripBtn: '查看行程', buddyFoot: '你收到此消息是因为你在寻找潜伴并关注了这个目的地。可以在个人资料中关闭。',
    lmSubj: (d, f) => `${d} 最后时刻：剩 ${f} 个位置`, lmBody: (c, f, w, pr) => `${c} 在 ${w} 的船上还剩 ${f} 个位置，${pr}。`, lmDisc: (u, p) => `原价 ${p}，现价 ${u}`, lmPrice: (p) => `价格 ${p}`, lmFoot: '你收到此提醒是因为你在个人资料中开启了最后时刻提醒，可以在那里关闭。',
  },
}
const L = (lang) => { const l = mailLang(lang); return [l, S[l]] }

// Plantillas: el último parámetro es siempre el idioma (es, en, de, ko, ja, zh; si no, inglés)
export const TEMPLATES = {
  confirm: (url, lang) => { const [l, s] = L(lang); return { subject: s.confirmSubj, html: wrap(l, `<h2>DivingSlot 🤿</h2><p>${s.confirmBody}</p>${button(url, s.confirmBtn)}${foot(s.confirmFoot)}`) } },
  recovery: (url, lang) => { const [l, s] = L(lang); return { subject: s.recoverySubj, html: wrap(l, `<h2>DivingSlot 🤿</h2><p>${s.recoveryBody}</p>${button(url, s.recoveryBtn)}${foot(s.ignoreFoot)}`) } },
  reauth: (code, lang) => { const [l, s] = L(lang); return { subject: s.reauthSubj, html: wrap(l, `<h2>DivingSlot</h2><p>${s.reauthBody}</p><p style="font-size:28px;letter-spacing:6px;font-weight:700" data-code="1">${esc(code)}</p>${foot(s.reauthFoot)}`) } },
  centerReviewed: (name, decision, text, url, lang) => {
    const [l, s] = L(lang); const ok = decision === 'verified'
    return { subject: ok ? s.verifiedSubj : s.reviewSubj, html: wrap(l, `<h2>DivingSlot 🤿</h2><p>${ok ? s.verifiedBody(b(name)) : s.reviewBody(b(name))}</p>${text ? note(esc(text)) : ''}${button(url, s.openBtn)}`) }
  },
  // 24 h antes: enlace para pagar el resto (o recordatorio de llevarlo en efectivo)
  balanceDue: (center, departs, due, url, cash, lang) => {
    const [l, s] = L(lang)
    return { subject: cash ? s.tomorrowSubj(center) : s.paySubj,
      html: wrap(l, `<h2>DivingSlot 🤿</h2><p>${(cash ? s.cashBody : s.payBody)(b(center), esc(when(departs, l)), `<b>${peso(due)}</b>`)}</p>${button(url, cash ? s.viewBtn : s.payBtn)}${foot(s.cardFoot)}`) }
  },
  // Día antes de la salida: hora, lugar, contacto, mar previsto y lo que queda por pagar
  tripTomorrow: (r, url, profileUrl, lang) => {
    const [l, s] = L(lang)
    const place = [r.locality, r.destination].filter((x, i, a) => x && a.indexOf(x) === i).join(', ')
    const map = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(r.lat != null && r.lng != null ? r.lat + ',' + r.lng : r.center + ' ' + (r.destination || ''))
    const wa = r.phone ? 'https://wa.me/' + String(r.phone).replace(/\D/g, '') : null
    const sea = r.sea && { good: s.seaGood, moderate: s.seaModerate, rough: s.seaRough }[r.sea.level]
    const seaNum = r.sea ? [r.sea.wave_m != null && r.sea.wave_m + ' m', r.sea.wind_kmh != null && r.sea.wind_kmh + ' km/h'].filter(Boolean).join(' · ') : ''
    const row = (k, v) => `<tr><td style="color:#5d7282;padding:3px 12px 3px 0;vertical-align:top">${k}</td><td style="padding:3px 0">${v}</td></tr>`
    const due = `<b>${peso(r.due)}</b>`
    const pay = r.due <= 0 ? s.paid : r.pay_on_site ? s.dueCash(due) : s.dueApp(due)
    return {
      subject: s.tomorrowSubj(r.center),
      html: wrap(l, `<h2>DivingSlot 🤿</h2><p>${s.ready}</p>
<table style="border-collapse:collapse;font-size:15px">
${row(s.departs, `<b>${esc(when(r.departs_at, l))}</b>`)}
${row(s.centre, `${b(r.center)}${place ? '<br>' + esc(place) : ''}<br><a href="${esc(map)}">${s.map}</a>${wa ? ` · <a href="${esc(wa)}">WhatsApp</a>` : ''}`)}
${r.boat ? row(s.boat, esc(r.boat)) : ''}
${row(s.spots, String(r.seats) + ' · ' + s.dives(r.num_dives || 2))}
${sea ? row(s.sea, `${sea}${seaNum ? ' (' + esc(seaNum) + ')' : ''}`) : ''}
${row(s.payment, pay)}
</table>
<p>${s.bring}</p>
${r.insured ? '' : note(s.noInsurance(`<a href="${esc(profileUrl)}">`))}
${button(url, r.due > 0 && !r.pay_on_site ? s.payBtn : s.viewBtn)}${foot(s.forecastFoot)}`),
    }
  },
  // El seguro de buceo que el buceador indicó en su perfil caduca pronto
  insuranceExpiring: (provider, expiry, danUrl, profileUrl, lang) => {
    const [l, s] = L(lang)
    return { subject: s.insSubj, html: wrap(l, `<h2>DivingSlot 🤿</h2><p>${s.insBody(b(provider), b(day(expiry, l)))}</p>${button(profileUrl, s.profileBtn)}<p><a href="${esc(danUrl)}">${s.danLink}</a></p>${foot(s.insFoot)}`) }
  },
  // Lista de espera: se ha liberado una plaza y está retenida unos minutos para el buceador
  waitlistOffer: (center, departs, mins, url, lang) => {
    const [l, s] = L(lang)
    return { subject: s.waitSubj(center), html: wrap(l, `<h2>DivingSlot 🤿</h2><p>${s.waitBody(b(center), esc(when(departs, l)), `<b>${s.mins(mins)}</b>`)}</p>${button(url, s.waitBtn)}${foot(s.waitFoot)}`) }
  },
  // Alguien de nivel parecido busca buddy en un destino que el buceador sigue
  buddyAlert: (name, level, center, dest, departs, url, lang) => {
    const [l, s] = L(lang)
    const who = b(name) + (level ? ' (' + esc(String(level).replace('_', ' ')) + ')' : '')
    return { subject: s.buddySubj(name, dest), html: wrap(l, `<h2>DivingSlot 🤿</h2><p>${s.buddyBody(who, b(center), esc(when(departs, l)))}</p>${button(url, s.tripBtn)}${foot(s.buddyFoot)}`) }
  },
  // Plazas de última hora en un destino que el buceador sigue
  lastMinute: (center, dest, departs, free, unit, price, url, lang) => {
    const [l, s] = L(lang)
    const pr = unit < price ? s.lmDisc(`<b>${peso(unit)}</b>`, peso(price)) : s.lmPrice(peso(price))
    return { subject: s.lmSubj(dest, free), html: wrap(l, `<h2>DivingSlot 🤿</h2><p>${s.lmBody(b(center), free, esc(when(departs, l)), pr)}</p>${button(url, s.tripBtn)}${foot(s.lmFoot)}`) }
  },
}

export async function sendEmail(env, to, { subject, html }) {
  const from = env.EMAIL_FROM || 'DivingSlot <no-reply@divingslot.com>'
  // Cloudflare Email Service (binding send_email «EMAIL» en wrangler.jsonc): sin claves. Necesita Workers Paid y el
  // dominio dado de alta en Email Sending (o, en el plan gratuito, solo a direcciones verificadas de Email Routing).
  if (env.EMAIL?.send) {
    const m = /^(.*?)\s*<([^>]+)>$/.exec(from)
    await env.EMAIL.send({ from: m ? { name: m[1], email: m[2] } : from, to, subject, html })
    return
  }
  if (env.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html }),
    })
    if (!r.ok) throw new Error('resend ' + r.status)
    return
  }
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) return smtpSend(env, to, subject, html)
  if (env.EMAIL_DEV_LOG === '1') { console.log('EMAIL (modo prueba)', to, subject, html.match(/href="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&') ?? html.match(/data-code="1">(\d{6})</)?.[1]); return }
  throw new Error('email no configurado')
}

// SMTP mínimo sobre TLS directo (puerto 465) con cloudflare:sockets
async function smtpSend(env, to, subject, html) {
  const { connect } = await import('cloudflare:sockets')
  const sock = connect({ hostname: env.SMTP_HOST, port: +(env.SMTP_PORT || 465) }, { secureTransport: 'on' })
  const w = sock.writable.getWriter(), r = sock.readable.getReader()
  const te = new TextEncoder(), td = new TextDecoder()
  let buf = ''
  const read = async () => {
    for (;;) {
      const m = /(^|\r\n)(\d{3}) [^\r\n]*\r\n$/.exec(buf)
      if (m) { const out = buf; buf = ''; return +m[2] === 0 ? out : out }
      const { value, done } = await r.read(); if (done) throw new Error('smtp cerrado')
      buf += td.decode(value)
    }
  }
  const cmd = async (line, ok) => { if (line !== null) await w.write(te.encode(line + '\r\n')); const res = await read(); if (!res.match(new RegExp(`(^|\\r\\n)${ok} `))) throw new Error('smtp ' + res.slice(0, 80)) }
  const fromAddr = (env.EMAIL_FROM || env.SMTP_USER).replace(/^.*<|>.*$/g, '')
  const b64 = (s) => btoa(String.fromCharCode(...te.encode(s)))
  await cmd(null, 220)
  await cmd('EHLO divingslot.com', 250)
  await cmd('AUTH PLAIN ' + b64(`\0${env.SMTP_USER}\0${env.SMTP_PASS}`), 235)
  await cmd(`MAIL FROM:<${fromAddr}>`, 250)
  await cmd(`RCPT TO:<${to}>`, 250)
  await cmd('DATA', 354)
  const body = b64(html).replace(/.{1,76}/g, '$&\r\n')
  const msg = [`From: ${env.EMAIL_FROM || 'DivingSlot <' + fromAddr + '>'}`, `To: <${to}>`, `Subject: =?UTF-8?B?${b64(subject)}?=`, 'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomUUID()}@divingslot.com>`, '', body, '.'].join('\r\n')
  await cmd(msg, 250)
  await w.write(te.encode('QUIT\r\n')).catch(() => {})
  await sock.close().catch(() => {})
}
