import { ProductJira, ProductBitbucket, Product, AuthInfo, AuthInfoEvent } from "../atlclients/authInfo";
import { window, StatusBarItem, StatusBarAlignment, Disposable, ConfigurationChangeEvent } from "vscode";
import { Commands } from "../commands";
import { Container } from "../container";
import { configuration } from "../config/configuration";
import { Resources } from "../resources";
import { JiraWorkingProjectConfigurationKey, JiraDefaultSiteConfigurationKey, BitbucketEnabledKey, JiraEnabledKey } from "../constants";

export class AuthStatusBar extends Disposable {
  private _authenticationStatusBarItems: Map<string, StatusBarItem> = new Map<
    string,
    StatusBarItem
  >();

  private _disposable: Disposable;

  constructor() {
    super(() => this.dispose());
    this._disposable = Disposable.from(
      Container.authManager.onDidAuthChange(this.onDidAuthChange, this)
      , configuration.onDidChange(this.onConfigurationChanged, this)
    );

    void this.onConfigurationChanged(configuration.initializingChangeEvent);
  }

  async onDidAuthChange(e: AuthInfoEvent) {
    if((e.site.product.name === 'Jira' && Container.config.jira.enabled) || (e.site.product.name === 'Bitbucket' && Container.config.bitbucket.enabled)){
      this.updateAuthenticationStatusBar(e.site.product, e.authInfo);
    }
  }

  protected async onConfigurationChanged(e: ConfigurationChangeEvent) {
    const initializing = configuration.initializing(e);
    if (initializing || 
        configuration.changed(e, 'jira.statusbar') || 
        configuration.changed(e, JiraDefaultSiteConfigurationKey) || 
        configuration.changed(e, JiraWorkingProjectConfigurationKey) ||
        configuration.changed(e, JiraEnabledKey)) 
    {
      const jiraItem = this.ensureStatusItem(ProductJira);
      if (Container.config.jira.statusbar.enabled && Container.config.jira.enabled) {
        const jiraInfo = await Container.authManager.getAuthInfo(Container.siteManager.effectiveSite(ProductJira));
        await this.updateAuthenticationStatusBar(ProductJira, jiraInfo);
      } else {
        jiraItem.hide();
      }
    }

    if (initializing || 
        configuration.changed(e, 'bitbucket.statusbar') || 
        configuration.changed(e, BitbucketEnabledKey)) 
    {
      const bitbucketItem = this.ensureStatusItem(ProductBitbucket);
      if (Container.config.bitbucket.statusbar.enabled && Container.config.bitbucket.enabled) {
        const bitbucketInfo = await Container.authManager.getAuthInfo(Container.siteManager.effectiveSite(ProductBitbucket));
        await this.updateAuthenticationStatusBar(ProductBitbucket, bitbucketInfo);
      } else {
        bitbucketItem.hide();
      }
    }
  }
  dispose() {
    this._authenticationStatusBarItems.forEach(item => {
      item.dispose();
    });
    this._authenticationStatusBarItems.clear();

    this._disposable.dispose();
  }

  private ensureStatusItem(product: Product): StatusBarItem {
    let statusBarItem = this._authenticationStatusBarItems.get(product.key);
    if (!statusBarItem) {
      statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left);
      this._authenticationStatusBarItems.set(product.key, statusBarItem);
    }
    return statusBarItem;
  }

  private async updateAuthenticationStatusBar(
    product: Product,
    info: AuthInfo | undefined
  ): Promise<void> {
    const statusBarItem = this.ensureStatusItem(product);
    await this.updateStatusBarItem(statusBarItem, product, info);
  }

  private async updateStatusBarItem(
    statusBarItem: StatusBarItem,
    product: Product,
    info: AuthInfo | undefined
  ): Promise<void> {
    let text: string = "$(sign-in)";
    let command: string | undefined;
    let showIt: boolean = true;
    const tmpl = Resources.html.get('statusBarText');

    switch (product.key) {
      case ProductJira.key: {
        if (info) {
          text = `$(person) ${product.name}: ${info.user.displayName}`;

          if (tmpl) {
            const effSite = Container.siteManager.effectiveSite(product);
            const effProject = await Container.jiraProjectManager.getEffectiveProject();
            const site = effSite.name;
            const project = effProject.name;

            const data = { product: product.name, user: info.user.displayName, site: site, project: project };
            const ctx = { ...Container.config.jira.statusbar, ...data };
            command = Commands.ShowConfigPage;
            text = tmpl(ctx);
          }

        } else {
          if (Container.config.jira.statusbar.showLogin) {
            text = `$(sign-in) Sign in to  ${product.name}`;
            command = Commands.ShowConfigPage;
            product = ProductJira;
          } else {
            statusBarItem.hide();
            showIt = false;
          }
        }

        break;
      }

      case ProductBitbucket.key: {
        if (info) {
          text = `$(person) ${product.name}: ${info.user.displayName}`;

          if (tmpl) {
            let data = { product: product.name, user: info.user.displayName };
            let ctx = { ...Container.config.bitbucket.statusbar, ...data };
            command = Commands.ShowConfigPage;
            text = tmpl(ctx);
          }
        } else {
          if (Container.config.bitbucket.statusbar.showLogin) {
            text = `$(sign-in) Sign in to ${product.name}`;
            command = Commands.ShowConfigPage;
            product = ProductBitbucket;
          } else {
            statusBarItem.hide();
            showIt = false;
          }
        }

        break;
      }
      default: {
        text = `$(person) Unknown Atlassian product ${product.name}`;
        command = undefined;
      }
    }

    statusBarItem.text = text;
    statusBarItem.command = command;
    statusBarItem.tooltip = `${product}`;

    if (showIt) {
      statusBarItem.show();
    }
  }
}
