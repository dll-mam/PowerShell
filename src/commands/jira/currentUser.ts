import { Container } from "../../container";
import { ProductJira, DetailedSiteInfo } from "../../atlclients/authInfo";
import { User } from "../../jira/jiraModel";


export async function currentUserJira(site?: DetailedSiteInfo): Promise<User> {
    let effectiveSite = site;
    if (!effectiveSite) {
        effectiveSite = Container.siteManager.effectiveSite(ProductJira);
    }

    const client = await Container.clientManager.jirarequest(Container.siteManager.effectiveSite(ProductJira));
    const resp = await client.getCurrentUser();
    return resp;
}
