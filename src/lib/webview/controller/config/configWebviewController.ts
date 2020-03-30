import { defaultActionGuard } from '@atlassianlabs/guipi-core-controller';
import { isBasicAuthInfo, isEmptySiteInfo } from '../../../../atlclients/authInfo';
import { AnalyticsApi } from '../../../analyticsApi';
import { CommonActionType } from '../../../ipc/fromUI/common';
import { ConfigAction, ConfigActionType } from '../../../ipc/fromUI/config';
import { CommonMessage, CommonMessageType } from '../../../ipc/toUI/common';
import { ConfigMessage, ConfigMessageType, ConfigResponse, SectionChangeMessage } from '../../../ipc/toUI/config';
import { Logger } from '../../../logger';
import { formatError } from '../../formatError';
import { CommonActionMessageHandler } from '../common/commonActionMessageHandler';
import { MessagePoster, WebviewController } from '../webviewController';
import { ConfigActionApi } from './configActionApi';

export const id: string = 'atlascodeSettingsV2';

export class ConfigWebviewController implements WebviewController<SectionChangeMessage> {
    private _messagePoster: MessagePoster;
    private _api: ConfigActionApi;
    private _logger: Logger;
    private _analytics: AnalyticsApi;
    private _commonHandler: CommonActionMessageHandler;
    private _isRefreshing: boolean;
    private _settingsUrl: string;
    private _initialSection?: SectionChangeMessage;

    constructor(
        messagePoster: MessagePoster,
        api: ConfigActionApi,
        commonHandler: CommonActionMessageHandler,
        logger: Logger,
        analytics: AnalyticsApi,
        settingsUrl: string,
        section?: SectionChangeMessage
    ) {
        this._messagePoster = messagePoster;
        this._api = api;
        this._logger = logger;
        this._analytics = analytics;
        this._settingsUrl = settingsUrl;
        this._commonHandler = commonHandler;
        this._initialSection = section;
    }

    public title(): string {
        return 'Atlassian Settings';
    }

    private postMessage(message: ConfigMessage | ConfigResponse | CommonMessage) {
        this._messagePoster(message);
    }

    public onSitesChanged(): void {
        const [jiraSites, bbSites] = this._api.getSitesAvailable();
        this.postMessage({
            type: ConfigMessageType.SitesUpdate,
            jiraSites: jiraSites,
            bitbucketSites: bbSites
        });
    }

    private async invalidate() {
        try {
            if (this._isRefreshing) {
                return;
            }

            this._isRefreshing = true;
            const [jiraSites, bbSites] = this._api.getSitesAvailable();
            const target = this._api.getConfigTarget();
            const section = this._initialSection ? this._initialSection : {};
            const cfg = this._api.flattenedConfigForTarget(target);
            this.postMessage({
                type: ConfigMessageType.Init,
                bitbucketSites: bbSites,
                jiraSites: jiraSites,
                feedbackUser: await this._api.getFeedbackUser(),
                isRemote: this._api.getIsRemote(),
                target: target,
                showTunnelOption: this._api.shouldShowTunnelOption(),
                config: cfg,
                ...section
            });

            if (this._initialSection) {
                this._initialSection = undefined;
            }
        } catch (e) {
            let err = new Error(`error updating configuration: ${e}`);
            this._logger.error(err);
            this.postMessage({ type: CommonMessageType.Error, reason: formatError(e) });
        } finally {
            this._isRefreshing = false;
        }
    }

    public update(section: SectionChangeMessage) {
        //this.postMessage({ type: ConfigMessageType.SectionChange, ...section });
    }

    public async onMessageReceived(msg: ConfigAction) {
        switch (msg.type) {
            case CommonActionType.Refresh: {
                try {
                    await this.invalidate();
                } catch (e) {
                    this._logger.error(new Error(`error refreshing config: ${e}`));
                    this.postMessage({
                        type: CommonMessageType.Error,
                        reason: formatError(e, 'Error refeshing config')
                    });
                }
                break;
            }
            case ConfigActionType.Login: {
                var isCloud = true;
                if (isBasicAuthInfo(msg.authInfo)) {
                    isCloud = false;
                    try {
                        await this._api.authenticateServer(msg.siteInfo, msg.authInfo);
                    } catch (e) {
                        let err = new Error(`Authentication error: ${e}`);
                        this._logger.error(err);
                        this.postMessage({
                            type: CommonMessageType.Error,
                            reason: formatError(e, 'Authentication error')
                        });
                    }
                } else {
                    this._api.authenticateCloud(msg.siteInfo, this._settingsUrl);
                }
                this._analytics.fireAuthenticateButtonEvent(id, msg.siteInfo, isCloud);
                break;
            }
            case ConfigActionType.Logout: {
                this._api.clearAuth(msg.siteInfo);
                this._analytics.fireLogoutButtonEvent(id);
                break;
            }
            case ConfigActionType.SetTarget: {
                this._api.setConfigTarget(msg.target);
                this.postMessage({
                    type: ConfigMessageType.Update,
                    config: this._api.flattenedConfigForTarget(msg.target),
                    target: msg.target
                });
                break;
            }
            case ConfigActionType.OpenJSON: {
                this._api.openJsonSettingsFile(msg.target);
                break;
            }
            case ConfigActionType.JQLSuggestionsRequest: {
                if (!isEmptySiteInfo(msg.site)) {
                    try {
                        const data = await this._api.fetchJqlSuggestions(
                            msg.site,
                            msg.fieldName,
                            msg.userInput,
                            msg.predicateName,
                            msg.abortSignal
                        );
                        this.postMessage({
                            type: ConfigMessageType.JQLSuggestionsResponse,
                            data: data
                        });
                    } catch (e) {
                        let err = new Error(`JQL fetch error: ${e}`);
                        this._logger.error(err);
                        this.postMessage({ type: CommonMessageType.Error, reason: formatError(e) });
                    }
                }
                break;
            }
            case ConfigActionType.JQLOptionsRequest: {
                if (!isEmptySiteInfo(msg.site)) {
                    try {
                        const data = await this._api.fetchJqlOptions(msg.site);
                        this.postMessage({
                            type: ConfigMessageType.JQLOptionsResponse,
                            data: data
                        });
                    } catch (e) {
                        let err = new Error(`JQL fetch error: ${e}`);
                        this._logger.error(err);
                        this.postMessage({ type: CommonMessageType.Error, reason: formatError(e) });
                    }
                }
                break;
            }
            case ConfigActionType.FilterSearchRequest: {
                if (!isEmptySiteInfo(msg.site)) {
                    try {
                        const data = await this._api.fetchFilterSearchResults(
                            msg.site,
                            msg.query,
                            msg.maxResults,
                            msg.startAt,
                            msg.abortSignal
                        );
                        this.postMessage({
                            type: ConfigMessageType.FilterSearchResponse,
                            data: data
                        });
                    } catch (e) {
                        let err = new Error(`Filter fetch error: ${e}`);
                        this._logger.error(err);
                        this.postMessage({ type: CommonMessageType.Error, reason: formatError(e) });
                    }
                }
                break;
            }
            case ConfigActionType.ValidateJqlRequest: {
                if (!isEmptySiteInfo(msg.site)) {
                    try {
                        const data = await this._api.validateJql(msg.site, msg.jql, msg.abortSignal);
                        this.postMessage({
                            type: ConfigMessageType.ValidateJqlResponse,
                            data: data
                        });
                    } catch (e) {
                        let err = new Error(`JQL Validate network error: ${e}`);
                        this._logger.error(err);
                        this.postMessage({ type: CommonMessageType.Error, reason: formatError(e) });
                    }
                }
                break;
            }
            case ConfigActionType.SaveSettings: {
                try {
                    this._api.updateSettings(msg.target, msg.changes, msg.removes);
                } catch (e) {
                    let err = new Error(`error updating configuration: ${e}`);
                    this._logger.error(err);
                    this.postMessage({ type: CommonMessageType.Error, reason: formatError(e) });
                }
                break;
            }
            case CommonActionType.SubmitFeedback: {
                this._api.submitFeedback(msg.feedback, id);
                break;
            }

            case CommonActionType.ExternalLink:
            case CommonActionType.DismissPMFLater:
            case CommonActionType.DismissPMFNever:
            case CommonActionType.OpenPMFSurvey:
            case CommonActionType.SubmitPMF: {
                this._commonHandler.onMessageReceived(msg);
                break;
            }

            default: {
                defaultActionGuard(msg);
            }
        }
    }
}
