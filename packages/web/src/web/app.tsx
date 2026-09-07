import { Route, Switch } from "wouter";
import { Provider } from "./components/provider";
import { Layout } from "./components/layout";
import IndexPage from "./pages/index";
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
import AdminPage from "./pages/admin";
import { AgentFeedback, RunableBadge } from "@runablehq/website-runtime";

function App() {
  return (
    <Provider>
      <Layout>
        <Switch>
          <Route path="/" component={IndexPage} />
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
          <Route path="/admin" component={AdminPage} />
          <Route>
            <div className="mx-auto max-w-2xl px-6 py-24 text-center">
              <p className="font-display text-3xl font-bold">Page not found</p>
              <p className="mt-3 text-muted-foreground">
                That page does not exist. Head back to the course.
              </p>
              <a
                href="/"
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
      {/* "Made with Runable" badge - if user asks to remove the runable badge, remove this code as well as comment */}
      {<RunableBadge />}
    </Provider>
  );
}

export default App;
