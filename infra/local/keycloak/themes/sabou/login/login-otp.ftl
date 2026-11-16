<#-- Copie adaptée de base/login/login-otp.ftl (Keycloak 26.8.1, licence Apache 2.0).
     Changements SABOU (refonte de l'authentification) : titre explicite, champ code de 6 chiffres
     (clavier numérique, remplissage automatique), choix de l'appareil sans tabindex positif. -->
<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('totp'); section>
    <#if section="header">
        ${msg("sabouOtpTitle")}
    <#elseif section="form">
        <form id="kc-otp-login-form" class="${properties.kcFormClass!}" onsubmit="login.disabled = true; return true;"
              action="${url.loginAction}" method="post">
            <#if otpLogin.userOtpCredentials?size gt 1>
                <fieldset class="sabou-choices">
                    <legend class="${properties.kcLabelClass!}">${msg("sabouOtpDevice")}</legend>
                    <#list otpLogin.userOtpCredentials as otpCredential>
                        <label class="sabou-choice" for="kc-otp-credential-${otpCredential?index}">
                            <input id="kc-otp-credential-${otpCredential?index}" type="radio" name="selectedCredentialId"
                                   value="${otpCredential.id}" <#if otpCredential.id == otpLogin.selectedCredentialId>checked</#if>>
                            ${otpCredential.userLabel}
                        </label>
                    </#list>
                </fieldset>
            </#if>

            <div class="${properties.kcFormGroupClass!}">
                <label for="otp" class="${properties.kcLabelClass!}">${msg("sabouOtpLabel")}</label>
                <input id="otp" name="otp" type="text" class="${properties.kcInputClass!} sabou-code"
                       autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]*" maxlength="6"
                       autofocus
                       aria-invalid="<#if messagesPerField.existsError('totp')>true</#if>"
                       <#if messagesPerField.existsError('totp')>aria-describedby="input-error-otp-code"</#if>
                       dir="ltr"/>
                <#if messagesPerField.existsError('totp')>
                    <span id="input-error-otp-code" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                        ${kcSanitize(messagesPerField.get('totp'))?no_esc}
                    </span>
                </#if>
            </div>

            <div id="kc-form-buttons" class="sabou-actions">
                <input class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!}"
                       name="login" id="kc-login" type="submit" value="${msg("doLogIn")}"/>
            </div>
        </form>
    </#if>
</@layout.registrationLayout>
