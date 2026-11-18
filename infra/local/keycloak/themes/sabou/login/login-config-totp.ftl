<#-- Copie adaptée de base/login/login-config-totp.ftl (Keycloak 26.8.1, licence Apache 2.0).
     Changements SABOU (refonte de l'authentification) :
     - trois étapes courtes : installer l'application, scanner, saisir le code ;
     - nom d'appareil pré-rempli (« Téléphone – date du jour »), champ caché : modifiable plus tard
       dans le compte ; Keycloak l'exige seulement à partir du deuxième appareil ;
     - pas de case « Se déconnecter des autres appareils » (non cochée : comportement inchangé) ;
     - champ code : 6 chiffres, clavier numérique, remplissage automatique du code. -->
<#import "template.ftl" as layout>
<@layout.registrationLayout displayRequiredFields=false displayMessage=!messagesPerField.existsError('totp','userLabel'); section>

    <#if section = "header">
        ${msg("sabouTotpTitle")}
    <#elseif section = "form">
        <ol id="kc-totp-settings" class="sabou-steps">
            <li>
                <span>${msg("sabouTotpStep1")}</span>
                <span class="sabou-step__hint">${msg("sabouTotpApps")}</span>
            </li>
            <#if mode?? && mode = "manual">
                <li>
                    ${msg("sabouTotpManualStep2")}
                    <span id="kc-totp-secret-key" class="sabou-secret">${totp.totpSecretEncoded}</span>
                    <a href="${totp.qrUrl}" id="mode-barcode" class="sabou-link">${msg("sabouTotpBackToQr")}</a>
                </li>
            <#else>
                <li>
                    <span>${msg("sabouTotpStep2")}</span>
                    <div class="sabou-scan">
                        <img id="kc-totp-secret-qr-code" class="sabou-qr" src="data:image/png;base64, ${totp.totpSecretQrCode}" alt="${msg("sabouTotpQrAlt")}" width="128" height="128">
                        <a href="${totp.manualUrl}" id="mode-manual" class="sabou-link">${msg("loginTotpUnableToScan")}</a>
                    </div>
                </li>
            </#if>
            <li>${msg("sabouTotpStep3")}</li>
        </ol>

        <form action="${url.loginAction}" class="${properties.kcFormClass!}" id="kc-totp-settings-form" method="post">
            <div class="${properties.kcFormGroupClass!}">
                <label for="totp" class="${properties.kcLabelClass!}">${msg("sabouOtpLabel")}</label>
                <input type="text" id="totp" name="totp" class="${properties.kcInputClass!} sabou-code"
                       autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]*" maxlength="6"
                       placeholder="123456" autofocus
                       aria-invalid="<#if messagesPerField.existsError('totp')>true</#if>"
                       <#if messagesPerField.existsError('totp')>aria-describedby="input-error-otp-code"</#if>
                       dir="ltr"/>
                <#if messagesPerField.existsError('totp')>
                    <span id="input-error-otp-code" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                        ${kcSanitize(messagesPerField.get('totp'))?no_esc}
                    </span>
                </#if>
                <#if messagesPerField.existsError('userLabel')>
                    <span id="input-error-otp-label" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                        ${kcSanitize(messagesPerField.get('userLabel'))?no_esc}
                    </span>
                </#if>
                <input type="hidden" id="totpSecret" name="totpSecret" value="${totp.totpSecret}"/>
                <#if mode??><input type="hidden" id="mode" name="mode" value="${mode}"/></#if>
                <input type="hidden" id="userLabel" name="userLabel" value="${msg("sabouTotpDevice", .now?string("dd/MM/yyyy"))}"/>
            </div>

            <div id="kc-form-buttons" class="sabou-actions">
                <input type="submit" class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!}"
                       id="saveTOTPBtn" value="${msg("doSubmit")}"/>
                <#if isAppInitiatedAction??>
                    <button type="submit" class="${properties.kcButtonClass!} ${properties.kcButtonDefaultClass!} ${properties.kcButtonBlockClass!}"
                            id="cancelTOTPBtn" name="cancel-aia" value="true">${msg("doCancel")}</button>
                </#if>
            </div>
        </form>
    </#if>
</@layout.registrationLayout>
