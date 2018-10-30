import { ConfigurationChangeEvent, ExtensionContext } from 'vscode';
import * as BitbucketKit from 'bitbucket';
import * as JiraKit from 'jira';
//import { JiraKit } from './jirakit/jirakit';
import * as authinfo from './authInfo';
import { AuthStore } from './authStore';
import { OAuthDancer } from './oauthDancer';
import { CacheMap, Interval } from '../util/cachemap';
import { Logger } from '../logger';
var tunnel = require("tunnel");
import * as fs from 'fs';
import { configuration } from '../config/configuration';
import { Resources } from '../resources';

// TODO: VSCODE-29 if user bails in oauth or an error happens, we need to return undefined
class ClientManager {
    private _clients:CacheMap = new CacheMap();
    private _dancer:OAuthDancer = new OAuthDancer();
    private _agent:any | undefined;
    private _optionsDirty:boolean = false;

    configure(context: ExtensionContext) {
        context.subscriptions.push(configuration.onDidChange(this.onConfigurationChanged, this));
        this.onConfigurationChanged(configuration.initializingChangeEvent);
    }

    public async bbrequest():Promise<BitbucketKit | undefined> {
        Logger.debug("getting bb client");
        
        return this.getClient<BitbucketKit>(authinfo.AuthProvider.BitbucketCloud,(info)=>{
            let bbclient = new BitbucketKit();
            bbclient.authenticate({type: 'token', token: info.access});

            return bbclient;
        });
    }

    public async jirarequest():Promise<JiraKit | undefined> {
        Logger.debug("getting jira client");
        
        return this.getClient<JiraKit>(authinfo.AuthProvider.JiraCloud,(info)=>{
            let cloudId:string = "";
            if(info.accessibleResources) {
                cloudId = info.accessibleResources[0].id;
            }

            let extraOptions = {};
            if (this._agent) {
                extraOptions = {agent: this._agent};
            }

            let jraclient = new JiraKit({baseUrl: `https://api.atlassian.com/ex/jira/${cloudId}/rest/`, options:extraOptions});
            jraclient.authenticate({type: 'token', token: info.access});

            return jraclient;
        });
    }

    private async getClient<T>(provider:string, factory:(info:authinfo.AuthInfo)=>any):Promise<T | undefined> {
        Logger.debug("getting client");
        let client = await this._clients.getItem<T>(provider);

        if (!client) {
            let info = await AuthStore.getAuthInfo(provider);

            if (!info) {
                // TODO: VSCODE-28 login with confirmation
                info = await this._dancer.doDance(provider);
                await AuthStore.saveAuthInfo(provider,info);
            } else {
                info = await this._dancer.refresh(info);
                await AuthStore.saveAuthInfo(provider,info);
            }

            Logger.debug("info is: " + JSON.stringify(info,null,2));
            Logger.debug("token is: " + info.access);
            client = factory(info);
            
            await this._clients.setItem(provider, client, 45 * Interval.MINUTE);
        }
        
        if (this._optionsDirty) {
            let info = await AuthStore.getAuthInfo(provider);

            if (info) {
                client = factory(info);
                await this._clients.updateItem(provider,client);
            }

            this._optionsDirty = false;
        }
        return client;
    }

    private onConfigurationChanged(e: ConfigurationChangeEvent) {
        const section = 'enableCharles';
        this._optionsDirty = true;
        Logger.debug('client manager got config change, charles? ' + configuration.get<boolean>(section));
        if (configuration.isDebugging && configuration.get<boolean>(section)) {
            this._agent = tunnel.httpsOverHttp({
                ca: [fs.readFileSync(Resources.charlesCert)],
                proxy: {
                  host: '127.0.0.1',
                  port: 8888
                }
              });

        } else {
            this._agent = undefined;
        }
    }
}

export const Atl = new ClientManager();