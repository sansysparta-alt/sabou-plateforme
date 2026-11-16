<#-- Copie de base/login/login-recovery-authn-code-config.ftl (Keycloak 26.8.1, licence Apache 2.0).
     Changements SABOU : une seule alerte, courte (refonte de l'authentification) ; codes sur
     deux colonnes ; trois actions de même taille ; pas de case « Se déconnecter des autres
     appareils » (non cochée : comportement inchangé) ; fichier et impression en français. -->
<#import "template.ftl" as layout>
<@layout.registrationLayout; section>

<#if section = "header">
    ${msg("sabouRecoveryTitle")}
<#elseif section = "form">
    <!-- warning -->
    <div class="alert-warning ${properties.kcAlertClass!}" role="status">
        <@layout.alertIcon type="warning" />
        <span class="${properties.kcAlertTitleClass!}">${msg("sabouRecoveryWarning")}</span>
    </div>

    <ol id="kc-recovery-codes-list" class="${properties.kcRecoveryCodesList!}">
        <#list recoveryAuthnCodesConfigBean.generatedRecoveryAuthnCodesList as code>
            <li><span class="sabou-codes__index">${code?counter}.</span> ${code[0..3]}-${code[4..7]}-${code[8..]}</li>
        </#list>
    </ol>

    <!-- actions -->
    <div class="${properties.kcRecoveryCodesActions!}">
        <button id="printRecoveryCodes" class="${properties.kcButtonClass!} ${properties.kcButtonSecondaryClass!}" type="button">
            ${msg("recovery-codes-print")}
        </button>
        <button id="downloadRecoveryCodes" class="${properties.kcButtonClass!} ${properties.kcButtonSecondaryClass!}" type="button">
            ${msg("recovery-codes-download")}
        </button>
        <button id="copyRecoveryCodes" class="${properties.kcButtonClass!} ${properties.kcButtonSecondaryClass!}" type="button">
            ${msg("recovery-codes-copy")}
        </button>
    </div>

    <!-- confirmation checkbox -->
    <label class="sabou-choice" for="kcRecoveryCodesConfirmationCheck">
        <input type="checkbox" id="kcRecoveryCodesConfirmationCheck" name="kcRecoveryCodesConfirmationCheck"
        onchange="document.getElementById('saveRecoveryAuthnCodesBtn').disabled = !this.checked;"
        />
        ${msg("recovery-codes-confirmation-message")}
    </label>

    <form action="${url.loginAction}" class="sabou-actions" id="kc-recovery-codes-settings-form" method="post">
        <input type="hidden" name="generatedRecoveryAuthnCodes" value="${recoveryAuthnCodesConfigBean.generatedRecoveryAuthnCodesAsString}" />
        <input type="hidden" name="generatedAt" value="${recoveryAuthnCodesConfigBean.generatedAt?c}" />
        <input type="hidden" id="userLabel" name="userLabel" value="${msg("recovery-codes-label-default")}" />

        <#if isAppInitiatedAction??>
            <input type="submit"
            class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!}"
            id="saveRecoveryAuthnCodesBtn" value="${msg("recovery-codes-action-complete")}"
            disabled
            />
            <button type="submit"
                class="${properties.kcButtonClass!} ${properties.kcButtonDefaultClass!} ${properties.kcButtonBlockClass!}"
                id="cancelRecoveryAuthnCodesBtn" name="cancel-aia" value="true" />${msg("recovery-codes-action-cancel")}
            </button>
        <#else>
            <input type="submit"
            class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}"
            id="saveRecoveryAuthnCodesBtn" value="${msg("recovery-codes-action-complete")}"
            disabled
            />
        </#if>
    </form>

    <script>
        <#outputformat "JavaScript">
        /* copy recovery codes  */
        function copyRecoveryCodes() {
            var tmpTextarea = document.createElement("textarea");
            var codes = document.querySelectorAll("#kc-recovery-codes-list li");
            for (i = 0; i < codes.length; i++) {
                tmpTextarea.value = tmpTextarea.value + codes[i].innerText + "\n";
            }
            document.body.appendChild(tmpTextarea);
            tmpTextarea.select();
            document.execCommand("copy");
            document.body.removeChild(tmpTextarea);
        }

        var copyButton = document.getElementById("copyRecoveryCodes");
        copyButton && copyButton.addEventListener("click", function () {
            copyRecoveryCodes();
        });

        /* download recovery codes  */
        function formatCurrentDateTime() {
            var dt = new Date();
            var options = {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: 'numeric',
                timeZoneName: 'short'
            };

            return dt.toLocaleString('fr-FR', options);
        }

        function parseRecoveryCodeList() {
            var recoveryCodes = document.querySelectorAll("#kc-recovery-codes-list li");
            var recoveryCodeList = "";

            for (var i = 0; i < recoveryCodes.length; i++) {
                var recoveryCodeLiElement = recoveryCodes[i].innerText;
                recoveryCodeList += recoveryCodeLiElement + "\r\n";
            }

            return recoveryCodeList;
        }

        function buildDownloadContent() {
            var recoveryCodeList = parseRecoveryCodeList();
            var dt = new Date();
            var options = {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: 'numeric',
                timeZoneName: 'short'
            };

            return fileBodyContent =
                ${msg("recovery-codes-download-file-header")?c} + "\n\n" +
                recoveryCodeList + "\n" +
                ${msg("recovery-codes-download-file-description")?c} + "\n\n" +
                ${msg("recovery-codes-download-file-date")?c} + " " + formatCurrentDateTime();
        }

        function setUpDownloadLinkAndDownload(filename, text) {
            var el = document.createElement('a');
            el.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
            el.setAttribute('download', filename);
            el.style.display = 'none';
            document.body.appendChild(el);
            el.click();
            document.body.removeChild(el);
        }

        function downloadRecoveryCodes() {
            setUpDownloadLinkAndDownload('sabou-codes-de-secours.txt', buildDownloadContent());
        }

        var downloadButton = document.getElementById("downloadRecoveryCodes");
        downloadButton && downloadButton.addEventListener("click", downloadRecoveryCodes);

        /* print recovery codes */
        function buildPrintContent() {
            var recoveryCodeListHTML = document.getElementById('kc-recovery-codes-list').innerHTML;
            var styles =
                `@page { size: auto;  margin-top: 0; }
                body { width: 480px; }
                div { list-style-type: none; font-family: monospace }
                p:first-of-type { margin-top: 48px }`;

            return printFileContent =
                "<html><style>" + styles + "</style><body>" +
                "<title>SABOU - codes de secours</title>" +
                "<p>" + ${msg("recovery-codes-download-file-header")?c} + "</p>" +
                "<div>" + recoveryCodeListHTML + "</div>" +
                "<p>" + ${msg("recovery-codes-download-file-description")?c} + "</p>" +
                "<p>" + ${msg("recovery-codes-download-file-date")?c} + " " + formatCurrentDateTime() + "</p>" +
                "</body></html>";
        }

        function printRecoveryCodes() {
            var w = window.open();
            w.document.write(buildPrintContent());
            w.print();
            w.close();
        }

        var printButton = document.getElementById("printRecoveryCodes");
        printButton && printButton.addEventListener("click", printRecoveryCodes);
        </#outputformat>
    </script>
</#if>
</@layout.registrationLayout>
