import { Route, Switch } from "wouter";
import { Provider } from "./components/provider";
import { Layout } from "./components/layout";
import IndexPage from "./pages/index";
import LandingPage from "./pages/landing";
import FeaturesPage from "./pages/features";
import PricingPage from "./pages/pricing";
import FaqPage from "./pages/faq";
import DownloadPage from "./pages/download";
import LessonPage from "./pages/lesson";
import FidelPage from "./pages/fidel";
import PronunciationPage from "./pages/pronunciation";
import QuizPage from "./pages/quiz";
import FlashcardsPage from "./pages/flashcards";
import PracticePage from "./pages/practice";
import TutorPage from "./pages/tutor";
import ProgressPage from "./pages/progress";
import SignInPage from "./pages/sign-in";
import SubscriptionPage from "./pages/subscription";
import BillingCallbackPage from "./pages/billing-callback";
import AdminPage from "./pages/admin";
import AccountPage from "./pages/account";
import { AboutPage, ContactPage, PrivacyPage, TermsPage } from "./pages/legal";
import { AgentFeedback } from "@runablehq/website-runtime";

function App() {
  return (
    <Provider>
      <Layout>
        <Switch>
          <Route path="/" component={LandingPage} />
          <Route path="/app" component={IndexPage} />
          <Route path="/features" component={FeaturesPage} />
          <Route path="/pricing" component={PricingPage} />
          <Route path="/faq" component={FaqPage} />
          <Route path="/download" component={DownloadPage} />
          <Route path="/lesson/:id" component={LessonPage} />
          <Route path="/fidel" component={FidelPage} />
          <Route path="/pronunciation" component={PronunciationPage} />
          <Route path="/practice" component={PracticePage} />
          <Route path="/flashcards" component={FlashcardsPage} />
          <Route path="/quiz/:lessonId" component={QuizPage} />
          <Route path="/tutor" component={TutorPage} />
          <Route path="/progress" component={ProgressPage} />
          <Route path="/sign-in" component={SignInPage} />
          <Route path="/subscription" component={SubscriptionPage} />
          {/* Where Paystack returns the customer after payment. The reference
              it carries is verified server-side; the redirect itself proves
              nothing. */}
          <Route path="/billing/callback" component={BillingCallbackPage} />
          <Route path="/admin" component={AdminPage} />
          <Route path="/account" component={AccountPage} />
          <Route path="/privacy" component={PrivacyPage} />
          <Route path="/terms" component={TermsPage} />
          <Route path="/about" component={AboutPage} />
          <Route path="/contact" component={ContactPage} />
          <Route>
            <div className="mx-auto max-w-2xl px-6 py-24 text-center">
              <p className="font-display text-3xl font-bold">Page not found</p>
              <p className="mt-3 text-muted-foreground">
                That page does not exist. Head back to the course.
              </p>
              <a
                href="/app"
                className="mt-6 inline-block rounded-full bg-primary px-6 py-3 font-medium text-primary-foreground"
              >
                Back to course
              </a>
            </div>
          </Route>
        </Switch>
      </Layout>
      {/* Do not remove — off by default, activated by parent iframe via postMessage */}
      {import.meta.env.DEV && <AgentFeedback />}
    </Provider>
  );
}

export default App;
